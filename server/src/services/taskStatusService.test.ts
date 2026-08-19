import { describe, it, expect } from 'vitest';
import { taskStatusService } from './taskStatusService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createTask } from '../test/factories.js';

/**
 * Task statuses are the Kanban board's columns, and they are per-user rows
 * rather than an enum — so every query in this service has to carry the userId
 * itself. Nothing in the schema will catch a missing one.
 *
 * Three things are load-bearing here.
 *
 * `position` is a plain integer maintained by the service. `create` reads
 * `max(position)` and adds one; if that aggregate ever loses its `userId`
 * filter, a new user's first column is numbered after some *other* user's
 * columns. Nothing visibly breaks — the board just orders wrongly for the
 * first user to notice.
 *
 * `reorder` writes N rows in one `$transaction`. A batch that names another
 * user's status must fail as a whole: a partial apply would leave the caller's
 * own board half-reordered, which is worse than rejecting outright.
 *
 * `delete` refuses to drop a status that tasks still use, and the count that
 * decides is scoped `{ userId, status }`. Losing `userId` makes another user's
 * identically-named column block yours; losing `status` makes any task at all
 * block every column. Both directions are asserted.
 */

/** Ids that are syntactically valid but belong to nothing. */
const MISSING_ID = '00000000-0000-0000-0000-000000000000';

describe('taskStatusService.findAll', () => {
  it('returns only the caller’s statuses', async () => {
    const { alice, bob } = await createTwoUsers();
    await taskStatusService.create(alice.id, { name: 'TODO', label: 'To do' });
    await taskStatusService.create(bob.id, { name: 'BACKLOG', label: 'Backlog' });

    const statuses = await taskStatusService.findAll(alice.id);

    expect(statuses.map((s) => s.name)).toEqual(['TODO']);
  });

  it('orders by position ascending, not by creation time', async () => {
    const { alice } = await createTwoUsers();
    const first = await taskStatusService.create(alice.id, { name: 'FIRST', label: 'First' });
    const second = await taskStatusService.create(alice.id, { name: 'SECOND', label: 'Second' });
    await prisma.taskStatus.update({ where: { id: first.id }, data: { position: 10 } });
    await prisma.taskStatus.update({ where: { id: second.id }, data: { position: 5 } });

    const statuses = await taskStatusService.findAll(alice.id);

    expect(statuses.map((s) => s.name)).toEqual(['SECOND', 'FIRST']);
  });
});

describe('taskStatusService.create', () => {
  it('normalises the name and defaults the colour', async () => {
    const { alice } = await createTwoUsers();

    const status = await taskStatusService.create(alice.id, { name: 'in  progress', label: 'In progress' });

    expect(status.name).toBe('IN_PROGRESS');
    expect(status.label).toBe('In progress');
    expect(status.color).toBe('#4589ff');
    expect(status.userId).toBe(alice.id);
  });

  it('keeps an explicit colour', async () => {
    const { alice } = await createTwoUsers();

    const status = await taskStatusService.create(alice.id, { name: 'DONE', label: 'Done', color: '#24a148' });

    expect(status.color).toBe('#24a148');
  });

  it('numbers positions from zero, in creation order', async () => {
    const { alice } = await createTwoUsers();

    const a = await taskStatusService.create(alice.id, { name: 'A', label: 'A' });
    const b = await taskStatusService.create(alice.id, { name: 'B', label: 'B' });
    const c = await taskStatusService.create(alice.id, { name: 'C', label: 'C' });

    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
  });

  it('numbers positions per user, not globally', async () => {
    // The max(position) aggregate must be scoped to the caller. Unscoped, Bob's
    // very first column would be numbered 3 and his board would order by
    // whatever Alice happened to have created.
    const { alice, bob } = await createTwoUsers();
    await taskStatusService.create(alice.id, { name: 'A', label: 'A' });
    await taskStatusService.create(alice.id, { name: 'B', label: 'B' });
    await taskStatusService.create(alice.id, { name: 'C', label: 'C' });

    const bobFirst = await taskStatusService.create(bob.id, { name: 'A', label: 'A' });

    expect(bobFirst.position).toBe(0);
  });

  it('rejects a duplicate name for the same user', async () => {
    const { alice } = await createTwoUsers();
    await taskStatusService.create(alice.id, { name: 'TODO', label: 'To do' });

    await expect(
      taskStatusService.create(alice.id, { name: 'todo', label: 'To do again' })
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.taskStatus.count({ where: { userId: alice.id } })).toBe(1);
  });

  it('lets two users own a status with the same name', async () => {
    const { alice, bob } = await createTwoUsers();
    await taskStatusService.create(alice.id, { name: 'TODO', label: 'To do' });

    const bobStatus = await taskStatusService.create(bob.id, { name: 'TODO', label: 'To do' });

    expect(bobStatus.userId).toBe(bob.id);
  });
});

describe('taskStatusService.update', () => {
  it('updates the label and colour of the caller’s status', async () => {
    const { alice } = await createTwoUsers();
    const status = await taskStatusService.create(alice.id, { name: 'TODO', label: 'To do' });

    const updated = await taskStatusService.update(alice.id, status.id, {
      label: 'Up next',
      color: '#8a3ffc',
    });

    expect(updated.label).toBe('Up next');
    expect(updated.color).toBe('#8a3ffc');
    // The machine name is not renameable — tasks store it as a string.
    expect(updated.name).toBe('TODO');
  });

  it('refuses to update another user’s status and leaves it untouched', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobStatus = await taskStatusService.create(bob.id, { name: 'TODO', label: 'Bob to do' });

    await expect(taskStatusService.update(alice.id, bobStatus.id, { label: 'Hijacked' })).rejects.toThrow();

    const after = await prisma.taskStatus.findUniqueOrThrow({ where: { id: bobStatus.id } });
    expect(after.label).toBe('Bob to do');
  });

  it('rejects an id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    await expect(taskStatusService.update(alice.id, MISSING_ID, { label: 'Nope' })).rejects.toThrow();
  });
});

describe('taskStatusService.reorder', () => {
  it('applies the new positions and the list follows them', async () => {
    const { alice } = await createTwoUsers();
    const a = await taskStatusService.create(alice.id, { name: 'A', label: 'A' });
    const b = await taskStatusService.create(alice.id, { name: 'B', label: 'B' });
    const c = await taskStatusService.create(alice.id, { name: 'C', label: 'C' });

    await taskStatusService.reorder(alice.id, [
      { id: c.id, position: 0 },
      { id: a.id, position: 1 },
      { id: b.id, position: 2 },
    ]);

    const statuses = await taskStatusService.findAll(alice.id);
    expect(statuses.map((s) => s.name)).toEqual(['C', 'A', 'B']);
  });

  it('cannot move another user’s status', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobStatus = await taskStatusService.create(bob.id, { name: 'BOB', label: 'Bob' });

    await expect(taskStatusService.reorder(alice.id, [{ id: bobStatus.id, position: 99 }])).rejects.toThrow();

    const after = await prisma.taskStatus.findUniqueOrThrow({ where: { id: bobStatus.id } });
    expect(after.position).toBe(0);
  });

  it('rolls the whole batch back when one item belongs to another user', async () => {
    // A partial apply would leave the caller's own board in a state they never
    // asked for — half reordered, with no error they can act on.
    const { alice, bob } = await createTwoUsers();
    const aliceA = await taskStatusService.create(alice.id, { name: 'A', label: 'A' });
    const aliceB = await taskStatusService.create(alice.id, { name: 'B', label: 'B' });
    const bobStatus = await taskStatusService.create(bob.id, { name: 'BOB', label: 'Bob' });

    await expect(
      taskStatusService.reorder(alice.id, [
        { id: aliceA.id, position: 7 },
        { id: bobStatus.id, position: 8 },
        { id: aliceB.id, position: 9 },
      ])
    ).rejects.toThrow();

    const alicePositions = (await taskStatusService.findAll(alice.id)).map((s) => s.position);
    expect(alicePositions).toEqual([0, 1]);
    expect((await prisma.taskStatus.findUniqueOrThrow({ where: { id: bobStatus.id } })).position).toBe(0);
  });
});

describe('taskStatusService.delete', () => {
  it('deletes an unused status the caller owns', async () => {
    const { alice } = await createTwoUsers();
    const status = await taskStatusService.create(alice.id, { name: 'UNUSED', label: 'Unused' });

    await taskStatusService.delete(alice.id, status.id);

    expect(await prisma.taskStatus.findUnique({ where: { id: status.id } })).toBeNull();
  });

  it('throws 404 for an id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    await expect(taskStatusService.delete(alice.id, MISSING_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses to delete another user’s status and leaves it in place', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobStatus = await taskStatusService.create(bob.id, { name: 'BOB', label: 'Bob' });

    await expect(taskStatusService.delete(alice.id, bobStatus.id)).rejects.toMatchObject({ statusCode: 404 });

    expect(await prisma.taskStatus.findUnique({ where: { id: bobStatus.id } })).not.toBeNull();
  });

  it('refuses to delete a status that tasks still use', async () => {
    // Deleting it would strand those tasks in a column the board no longer
    // renders — they would vanish from the Kanban view without being deleted.
    const { alice } = await createTwoUsers();
    const status = await taskStatusService.create(alice.id, { name: 'IN_REVIEW', label: 'In review' });
    await createTask(alice.id, { title: 'Still here', status: 'IN_REVIEW' });

    await expect(taskStatusService.delete(alice.id, status.id)).rejects.toMatchObject({ statusCode: 409 });

    expect(await prisma.taskStatus.findUnique({ where: { id: status.id } })).not.toBeNull();
  });

  it('ignores another user’s tasks when deciding whether a status is in use', async () => {
    // The in-use count is scoped `{ userId, status }`. Drop the userId and
    // Bob's identically-named column makes Alice's column undeletable forever.
    const { alice, bob } = await createTwoUsers();
    const aliceStatus = await taskStatusService.create(alice.id, { name: 'IN_REVIEW', label: 'In review' });
    await taskStatusService.create(bob.id, { name: 'IN_REVIEW', label: 'In review' });
    await createTask(bob.id, { title: 'Bob is reviewing', status: 'IN_REVIEW' });

    await taskStatusService.delete(alice.id, aliceStatus.id);

    expect(await prisma.taskStatus.findUnique({ where: { id: aliceStatus.id } })).toBeNull();
    expect(await prisma.task.count({ where: { userId: bob.id } })).toBe(1);
  });

  it('ignores the caller’s tasks that sit in a different status', async () => {
    // The other half of the same where-clause: drop `status` and owning any
    // task at all would block deleting any column.
    const { alice } = await createTwoUsers();
    const unused = await taskStatusService.create(alice.id, { name: 'UNUSED', label: 'Unused' });
    await createTask(alice.id, { title: 'Elsewhere', status: 'TODO' });

    await taskStatusService.delete(alice.id, unused.id);

    expect(await prisma.taskStatus.findUnique({ where: { id: unused.id } })).toBeNull();
  });
});
