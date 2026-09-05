import { describe, it, expect } from 'vitest';
import { taskService } from './taskService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createTask, shareTaskWith, seedTaskStatuses } from '../test/factories.js';

/**
 * Batch actions and saved views.
 *
 * A batch applies to what it may and reports the rest with a reason, rather
 * than failing on the first refusal. The per-row rules are the single-task
 * ones: access for a status change, ownership for assigning, labelling and
 * deleting; the dependency gate still applies row by row. These run against
 * a real Postgres.
 */
describe('taskService — batch actions', () => {
  it('moves the rows it may, skips a blocked one with the reason, and never touches another account\'s', async () => {
    const { alice, bob } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const a = await createTask(alice.id, { title: 'A' });
    const b = await createTask(alice.id, { title: 'B' });
    const blocker = await createTask(alice.id, { title: 'Blocker' });
    const blocked = await createTask(alice.id, { title: 'Blocked' });
    await taskService.addDependency(alice.id, blocked.id, blocker.id);
    const shared = await createTask(bob.id, { title: 'Shared from Bob' });
    await shareTaskWith(shared.id, bob.id, alice.id);
    const bobs = await createTask(bob.id, { title: 'BobsSecretTask' });

    const result = await taskService.batchStatus(alice.id, [a.id, b.id, blocked.id, shared.id, bobs.id], 'DONE');

    expect(result.updated).toBe(3);
    expect(result.skipped.map((s) => s.id).sort()).toEqual([blocked.id, bobs.id].sort());
    expect(result.skipped.find((s) => s.id === blocked.id)!.reason).toContain('Blocker');
    expect(JSON.stringify(result)).not.toContain('BobsSecretTask');
    const statuses = await prisma.task.findMany({ where: { id: { in: [a.id, b.id, blocked.id, shared.id, bobs.id] } }, select: { id: true, status: true } });
    const byId = Object.fromEntries(statuses.map((s) => [s.id, s.status]));
    expect(byId).toMatchObject({ [a.id]: 'DONE', [b.id]: 'DONE', [shared.id]: 'DONE', [blocked.id]: 'TODO', [bobs.id]: 'TODO' });
  });

  it('a batch finish spawns the next occurrence of a repeating task', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const task = await taskService.create(alice.id, { title: 'Weekly', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO', dueDate: '2026-09-07T09:00:00.000Z' });

    await taskService.batchStatus(alice.id, [task.id], 'DONE');

    expect(await prisma.task.count({ where: { title: 'Weekly' } })).toBe(2);
  });

  it('assigning, labelling and deleting are owner-only, row by row — REGRESSION guard', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createTask(alice.id, { title: 'Mine' });
    const shared = await createTask(bob.id, { title: 'Shared from Bob' });
    await shareTaskWith(shared.id, bob.id, alice.id);
    const label = await prisma.label.create({ data: { userId: alice.id, name: 'Ops', color: '#000000' } });

    const assigned = await taskService.batchAssign(alice.id, [mine.id, shared.id], bob.id);
    expect(assigned).toMatchObject({ updated: 1 });
    expect(assigned.skipped.map((s) => s.id)).toEqual([shared.id]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: shared.id } })).assignedToId).toBeNull();

    const labelled = await taskService.batchLabel(alice.id, [mine.id, shared.id], label.id);
    expect(labelled.updated).toBe(1);
    expect(await prisma.taskLabel.count({ where: { labelId: label.id } })).toBe(1);
    // Twice is still one row.
    await taskService.batchLabel(alice.id, [mine.id], label.id);
    expect(await prisma.taskLabel.count({ where: { labelId: label.id } })).toBe(1);

    const deleted = await taskService.batchDelete(alice.id, [mine.id, shared.id]);
    expect(deleted.updated).toBe(1);
    expect(await prisma.task.findUnique({ where: { id: mine.id } })).toBeNull();
    expect(await prisma.task.findUnique({ where: { id: shared.id } })).not.toBeNull();
  });

  it('refuses another account\'s label outright', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createTask(alice.id);
    const bobsLabel = await prisma.label.create({ data: { userId: bob.id, name: 'BobsLabel', color: '#000000' } });
    await expect(taskService.batchLabel(alice.id, [mine.id], bobsLabel.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.taskLabel.count()).toBe(0);
  });
});

describe('taskService — saved views', () => {
  it('saves, lists, renames and deletes views, unique per account', async () => {
    const { alice, bob } = await createTwoUsers();
    const view = await taskService.saveView(alice.id, { name: 'Urgent mine', filters: { priority: 'URGENT', ownership: 'owned' }, sortBy: 'dueDate', sortOrder: 'asc' });
    expect(view).toMatchObject({ filters: { priority: 'URGENT', ownership: 'owned' }, sortBy: 'dueDate', sortOrder: 'asc' });

    await expect(taskService.saveView(alice.id, { name: 'Urgent mine', filters: {} })).rejects.toMatchObject({ statusCode: 409 });
    await taskService.saveView(bob.id, { name: 'Urgent mine', filters: {} });

    expect((await taskService.listViews(alice.id)).map((v) => v.name)).toEqual(['Urgent mine']);
    await expect(taskService.updateView(bob.id, view.id, { name: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(taskService.deleteView(bob.id, view.id)).rejects.toMatchObject({ statusCode: 404 });

    const renamed = await taskService.updateView(alice.id, view.id, { name: 'Fires' });
    expect(renamed.name).toBe('Fires');
    await taskService.deleteView(alice.id, view.id);
    expect(await prisma.taskView.count({ where: { userId: alice.id } })).toBe(0);
  });
});
