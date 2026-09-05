import { describe, it, expect } from 'vitest';
import { taskService } from './taskService.js';
import { prisma } from '../lib/prisma.js';
import {
  createTwoUsers,
  createTask,
  createCustomer,
  shareTaskWith,
  seedTaskStatuses,
} from '../test/factories.js';

/**
 * Subtasks and checklists.
 *
 * Two rules carry the design and both live in the service, not the schema:
 * a hierarchy is at most two levels deep, and a parent is always owned by the
 * same account as its child. The foreign key accepts neither constraint on
 * its own — any task id satisfies it — so a test that only exercised Prisma
 * would pass with both rules deleted. These run against a real Postgres.
 */
describe('taskService — subtasks', () => {
  it('creates a subtask under a parent and inherits the company', async () => {
    const { alice } = await createTwoUsers();
    const acme = await createCustomer(alice.id, { name: 'Acme' });
    const parent = await createTask(alice.id, { title: 'Renew contract', customerId: acme.id });

    const child = await taskService.create(alice.id, { title: 'Draft terms', parentId: parent.id });

    expect(child.parentId).toBe(parent.id);
    expect(child.parent).toEqual({ id: parent.id, title: 'Renew contract' });
    expect(child.customerId).toBe(acme.id);
  });

  it('an explicit company on the subtask wins over the inherited one', async () => {
    const { alice } = await createTwoUsers();
    const acme = await createCustomer(alice.id, { name: 'Acme' });
    const parent = await createTask(alice.id, { customerId: acme.id });

    const child = await taskService.create(alice.id, { title: 'No company', parentId: parent.id, customerId: null });

    expect(child.customerId).toBeNull();
  });

  it('refuses a parent owned by another account — REGRESSION guard', async () => {
    // The FK would accept Bob's id, and findById would then return Bob's
    // title through `parent` to Alice.
    const { alice, bob } = await createTwoUsers();
    const bobsTask = await createTask(bob.id, { title: 'BobsSecretTask' });

    await expect(
      taskService.create(alice.id, { title: 'Sneaky', parentId: bobsTask.id })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.task.count({ where: { parentId: bobsTask.id } })).toBe(0);
  });

  it('a share does not make another account\'s task a valid parent', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createTask(bob.id);
    await shareTaskWith(shared.id, bob.id, alice.id);

    await expect(
      taskService.create(alice.id, { title: 'Under a shared task', parentId: shared.id })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a third level: a subtask cannot be a parent', async () => {
    const { alice } = await createTwoUsers();
    const root = await createTask(alice.id);
    const child = await createTask(alice.id, { parentId: root.id });

    await expect(
      taskService.create(alice.id, { title: 'Grandchild', parentId: child.id })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PARENT' });
  });

  it('refuses to move a task that has subtasks under another task', async () => {
    const { alice } = await createTwoUsers();
    const root = await createTask(alice.id);
    await createTask(alice.id, { parentId: root.id });
    const other = await createTask(alice.id);

    await expect(
      taskService.update(alice.id, root.id, { parentId: other.id })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PARENT' });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: root.id } })).parentId).toBeNull();
  });

  it('refuses a task as its own parent', async () => {
    const { alice } = await createTwoUsers();
    const task = await createTask(alice.id);

    await expect(taskService.update(alice.id, task.id, { parentId: task.id })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('update can attach and detach a parent', async () => {
    const { alice } = await createTwoUsers();
    const root = await createTask(alice.id, { title: 'Root' });
    const loose = await createTask(alice.id);

    const attached = await taskService.update(alice.id, loose.id, { parentId: root.id });
    expect(attached.parent).toEqual({ id: root.id, title: 'Root' });

    const detached = await taskService.update(alice.id, loose.id, { parentId: null });
    expect(detached.parentId).toBeNull();
    expect(detached.parent).toBeNull();
  });

  it('counts subtasks and how many are in a terminal status', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const root = await createTask(alice.id);
    await createTask(alice.id, { parentId: root.id, status: 'DONE' });
    await createTask(alice.id, { parentId: root.id, status: 'DONE' });
    await createTask(alice.id, { parentId: root.id, status: 'TODO' });
    // Somebody else's subtask count must not bleed into this row.
    const unrelated = await createTask(alice.id);
    await createTask(alice.id, { parentId: unrelated.id });

    const list = await taskService.findAll(alice.id, { search: '' });
    const row = list.data.find((t) => t.id === root.id)!;
    expect(row).toMatchObject({ subtaskCount: 3, subtaskDoneCount: 2 });
    expect(list.data.find((t) => t.id === unrelated.id)).toMatchObject({ subtaskCount: 1, subtaskDoneCount: 0 });

    const detail = await taskService.findById(alice.id, root.id);
    expect(detail).toMatchObject({ subtaskCount: 3, subtaskDoneCount: 2 });
    expect(detail.subtasks).toHaveLength(3);
    expect(detail.subtasks.map((s: { status: string }) => s.status).sort()).toEqual(['DONE', 'DONE', 'TODO']);
  });

  it('"done" means the account\'s terminal statuses, not the name DONE', async () => {
    const { alice } = await createTwoUsers();
    await prisma.taskStatus.createMany({
      data: [
        { userId: alice.id, name: 'OPEN', label: 'Open', position: 0 },
        { userId: alice.id, name: 'SHIPPED', label: 'Shipped', position: 1, isTerminal: true },
      ],
    });
    const root = await createTask(alice.id, { status: 'OPEN' });
    await createTask(alice.id, { parentId: root.id, status: 'SHIPPED' });
    await createTask(alice.id, { parentId: root.id, status: 'SHIPPED' });
    // Not terminal on this account, whatever the name suggests. Two SHIPPED
    // and one DONE so that counting by name (1) and by flag (2) disagree.
    await createTask(alice.id, { parentId: root.id, status: 'DONE' });

    const detail = await taskService.findById(alice.id, root.id);
    expect(detail).toMatchObject({ subtaskCount: 3, subtaskDoneCount: 2 });
  });

  it('findAll can restrict to one parent\'s subtasks, or to top-level tasks', async () => {
    const { alice } = await createTwoUsers();
    const root = await createTask(alice.id, { title: 'root' });
    const child = await createTask(alice.id, { title: 'child', parentId: root.id });
    const other = await createTask(alice.id, { title: 'other' });

    const children = await taskService.findAll(alice.id, { parentId: root.id });
    expect(children.data.map((t) => t.id)).toEqual([child.id]);

    const top = await taskService.findAll(alice.id, { topLevel: 'true' });
    expect(top.data.map((t) => t.id).sort()).toEqual([root.id, other.id].sort());
  });

  it('deleting a parent deletes its subtasks', async () => {
    const { alice } = await createTwoUsers();
    const root = await createTask(alice.id);
    const child = await createTask(alice.id, { parentId: root.id });

    await taskService.delete(alice.id, root.id);

    expect(await prisma.task.findUnique({ where: { id: child.id } })).toBeNull();
  });

  it('the By Company view carries the same progress counts', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const acme = await createCustomer(alice.id, { name: 'Acme' });
    const root = await createTask(alice.id, { customerId: acme.id });
    await createTask(alice.id, { parentId: root.id, customerId: acme.id, status: 'DONE' });
    await createTask(alice.id, { parentId: root.id, customerId: acme.id, status: 'TODO' });

    const grouped = await taskService.findGroupedByCompany(alice.id, {});
    const row = grouped.data[0].tasks.find((t) => t.id === root.id)!;
    expect(row).toMatchObject({ subtaskCount: 2, subtaskDoneCount: 1 });
  });
});

describe('taskService — checklist', () => {
  it('adds, ticks, renames and removes items, with counts on the task', async () => {
    const { alice } = await createTwoUsers();
    const task = await createTask(alice.id);

    const a = await taskService.addChecklistItem(alice.id, task.id, { text: 'Call Sam' });
    const b = await taskService.addChecklistItem(alice.id, task.id, { text: 'Send the deck' });
    expect(b.position).toBeGreaterThan(a.position);

    const ticked = await taskService.updateChecklistItem(alice.id, task.id, a.id, { isDone: true });
    expect(ticked.isDone).toBe(true);
    expect(ticked.completedAt).not.toBeNull();

    const renamed = await taskService.updateChecklistItem(alice.id, task.id, b.id, { text: 'Send the revised deck' });
    expect(renamed.text).toBe('Send the revised deck');

    let detail = await taskService.findById(alice.id, task.id);
    expect(detail).toMatchObject({ checklistCount: 2, checklistDoneCount: 1 });
    expect(detail.checklist!.map((i: { text: string }) => i.text)).toEqual(['Call Sam', 'Send the revised deck']);

    const unticked = await taskService.updateChecklistItem(alice.id, task.id, a.id, { isDone: false });
    expect(unticked.completedAt).toBeNull();

    await taskService.deleteChecklistItem(alice.id, task.id, a.id);
    detail = await taskService.findById(alice.id, task.id);
    expect(detail).toMatchObject({ checklistCount: 1, checklistDoneCount: 0 });

    // List rows carry the counts but not the items.
    const row = (await taskService.findAll(alice.id, {})).data.find((t) => t.id === task.id)!;
    expect(row).toMatchObject({ checklistCount: 1, checklistDoneCount: 0 });
    expect(row).not.toHaveProperty('checklist');
  });

  it('a share recipient can tick an item; a stranger cannot see the task', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(bob.id);
    const item = await taskService.addChecklistItem(bob.id, task.id, { text: 'Shared step' });

    await expect(
      taskService.updateChecklistItem(alice.id, task.id, item.id, { isDone: true })
    ).rejects.toMatchObject({ statusCode: 404 });

    await shareTaskWith(task.id, bob.id, alice.id);
    const ticked = await taskService.updateChecklistItem(alice.id, task.id, item.id, { isDone: true });
    expect(ticked.isDone).toBe(true);
  });

  it('an item id from another task is a 404, not an edit — REGRESSION guard', async () => {
    // Both writes name the task AND the item. Naming only the item would let
    // any caller with access to any task edit any item in the table.
    const { alice, bob } = await createTwoUsers();
    const mine = await createTask(alice.id);
    const bobs = await createTask(bob.id);
    const bobsItem = await taskService.addChecklistItem(bob.id, bobs.id, { text: 'BobsSecretStep' });

    await expect(
      taskService.updateChecklistItem(alice.id, mine.id, bobsItem.id, { isDone: true })
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(taskService.deleteChecklistItem(alice.id, mine.id, bobsItem.id)).rejects.toMatchObject({
      statusCode: 404,
    });

    const untouched = await prisma.taskChecklistItem.findUniqueOrThrow({ where: { id: bobsItem.id } });
    expect(untouched.isDone).toBe(false);
  });

  it('items go with the task when it is deleted', async () => {
    const { alice } = await createTwoUsers();
    const task = await createTask(alice.id);
    const item = await taskService.addChecklistItem(alice.id, task.id, { text: 'x' });

    await taskService.delete(alice.id, task.id);

    expect(await prisma.taskChecklistItem.findUnique({ where: { id: item.id } })).toBeNull();
  });
});
