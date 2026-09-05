import { describe, it, expect } from 'vitest';
import { taskService } from './taskService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createTask, shareTaskWith, seedTaskStatuses } from '../test/factories.js';

/**
 * Dependencies: "blocker must finish before blocked can".
 *
 * Three rules, all in the service because a join table cannot express any of
 * them: both tasks belong to the same account, the graph stays acyclic, and
 * a blocked task does not reach a terminal status while a blocker is open —
 * unless the caller says so explicitly. These run against a real Postgres.
 */
describe('taskService — dependencies', () => {
  it('adds and removes a dependency, and both ends see it', async () => {
    const { alice } = await createTwoUsers();
    const design = await createTask(alice.id, { title: 'Design' });
    const build = await createTask(alice.id, { title: 'Build' });

    const withDep = await taskService.addDependency(alice.id, build.id, design.id);
    expect(withDep.blockedBy.map((b: { title: string }) => b.title)).toEqual(['Design']);
    expect(withDep).toMatchObject({ blockedByCount: 1, openBlockerCount: 1, blocksCount: 0 });

    const other = await taskService.findById(alice.id, design.id);
    expect(other.blocks.map((b: { title: string }) => b.title)).toEqual(['Build']);
    expect(other).toMatchObject({ blocksCount: 1, blockedByCount: 0 });

    // Adding it twice is not an error and not a second row.
    await taskService.addDependency(alice.id, build.id, design.id);
    expect(await prisma.taskDependency.count({ where: { blockedId: build.id } })).toBe(1);

    const removed = await taskService.removeDependency(alice.id, build.id, design.id);
    expect(removed.blockedBy).toEqual([]);
    await expect(taskService.removeDependency(alice.id, build.id, design.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a blocker owned by another account — REGRESSION guard', async () => {
    // The FK accepts Bob's id, and findById would echo Bob's title back to
    // Alice through `blockedBy`.
    const { alice, bob } = await createTwoUsers();
    const mine = await createTask(alice.id);
    const bobs = await createTask(bob.id, { title: 'BobsSecretTask' });

    await expect(taskService.addDependency(alice.id, mine.id, bobs.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.taskDependency.count()).toBe(0);
  });

  it('a share recipient may add a dependency between the owner\'s tasks, not to their own', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createTask(alice.id, { title: 'Shared' });
    const alicesOther = await createTask(alice.id, { title: 'Alice other' });
    const bobsOwn = await createTask(bob.id, { title: 'Bob own' });
    await shareTaskWith(shared.id, alice.id, bob.id);

    const ok = await taskService.addDependency(bob.id, shared.id, alicesOther.id);
    expect(ok.blockedBy.map((b: { id: string }) => b.id)).toEqual([alicesOther.id]);

    await expect(taskService.addDependency(bob.id, shared.id, bobsOwn.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a self-dependency and a cycle, however long', async () => {
    const { alice } = await createTwoUsers();
    const a = await createTask(alice.id, { title: 'A' });
    const b = await createTask(alice.id, { title: 'B' });
    const c = await createTask(alice.id, { title: 'C' });

    await expect(taskService.addDependency(alice.id, a.id, a.id)).rejects.toMatchObject({ statusCode: 400 });

    // A waits on B, B waits on C. Then "C waits on A" closes the loop.
    await taskService.addDependency(alice.id, a.id, b.id);
    await taskService.addDependency(alice.id, b.id, c.id);
    await expect(taskService.addDependency(alice.id, c.id, a.id)).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_DEPENDENCY',
    });
    // And the direct reverse.
    await expect(taskService.addDependency(alice.id, b.id, a.id)).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.taskDependency.count()).toBe(2);
  });

  it('a blocked task cannot be finished while a blocker is open, unless forced', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const design = await createTask(alice.id, { title: 'Design', status: 'TODO' });
    const build = await createTask(alice.id, { title: 'Build', status: 'TODO' });
    await taskService.addDependency(alice.id, build.id, design.id);

    await expect(taskService.update(alice.id, build.id, { status: 'DONE' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'TASK_BLOCKED',
      details: { blockers: [{ id: design.id, title: 'Design' }] },
    });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: build.id } })).status).toBe('TODO');

    // Moving to a NON-terminal status is not gated.
    await taskService.update(alice.id, build.id, { status: 'IN_PROGRESS' });

    const forced = await taskService.update(alice.id, build.id, { status: 'DONE', force: true });
    expect(forced.status).toBe('DONE');
  });

  it('the gate lifts once the blocker is finished', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const design = await createTask(alice.id, { title: 'Design', status: 'TODO' });
    const build = await createTask(alice.id, { title: 'Build', status: 'TODO' });
    await taskService.addDependency(alice.id, build.id, design.id);

    await taskService.update(alice.id, design.id, { status: 'DONE' });
    const done = await taskService.update(alice.id, build.id, { status: 'DONE' });
    expect(done.status).toBe('DONE');
    expect(done).toMatchObject({ blockedByCount: 1, openBlockerCount: 0 });
  });

  it('a drag into a finished column is refused for a blocked task', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const design = await createTask(alice.id, { title: 'Design', status: 'TODO' });
    const build = await createTask(alice.id, { title: 'Build', status: 'TODO' });
    const free = await createTask(alice.id, { title: 'Free', status: 'TODO' });
    await taskService.addDependency(alice.id, build.id, design.id);

    await expect(
      taskService.reorder(alice.id, {
        items: [
          { id: build.id, status: 'DONE', position: 1000 },
          { id: free.id, status: 'DONE', position: 2000 },
        ],
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'TASK_BLOCKED' });
    // Nothing moved — the refusal comes before the transaction.
    expect((await prisma.task.findUniqueOrThrow({ where: { id: free.id } })).status).toBe('TODO');

    // The unblocked task alone moves fine.
    await taskService.reorder(alice.id, { items: [{ id: free.id, status: 'DONE', position: 1000 }] });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: free.id } })).status).toBe('DONE');
  });

  it('findAll can narrow to blocked or unblocked tasks, by the account\'s terminal statuses', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const openBlocker = await createTask(alice.id, { title: 'open blocker', status: 'TODO' });
    const doneBlocker = await createTask(alice.id, { title: 'done blocker', status: 'DONE' });
    const blocked = await createTask(alice.id, { title: 'blocked' });
    const released = await createTask(alice.id, { title: 'released' });
    const free = await createTask(alice.id, { title: 'free' });
    await taskService.addDependency(alice.id, blocked.id, openBlocker.id);
    await taskService.addDependency(alice.id, released.id, doneBlocker.id);

    const blockedOnly = await taskService.findAll(alice.id, { blocked: 'true' });
    expect(blockedOnly.data.map((t) => t.title)).toEqual(['blocked']);

    const unblocked = await taskService.findAll(alice.id, { blocked: 'false' });
    expect(unblocked.data.map((t) => t.title).sort()).toEqual(['done blocker', 'free', 'open blocker', 'released']);
    expect(unblocked.data.find((t) => t.id === free.id)).toMatchObject({ openBlockerCount: 0 });
  });

  it('a dependency goes with either task', async () => {
    const { alice } = await createTwoUsers();
    const a = await createTask(alice.id);
    const b = await createTask(alice.id);
    await taskService.addDependency(alice.id, a.id, b.id);

    await taskService.delete(alice.id, b.id);

    expect(await prisma.taskDependency.count()).toBe(0);
    expect((await taskService.findById(alice.id, a.id)).blockedBy).toEqual([]);
  });
});
