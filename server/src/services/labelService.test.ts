import { describe, it, expect } from 'vitest';
import { labelService } from './labelService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createTask } from '../test/factories.js';

/**
 * Labels: tenant scoping, name uniqueness, and what deleting one destroys.
 *
 * Two things make this service worth pinning down.
 *
 * The first is that `name` is unique **per user** (`@@unique([userId, name])`).
 * Every duplicate check therefore has to carry the userId, and the tests below
 * assert both halves: a second "Urgent" for the same user is a 409, and a
 * second "Urgent" for a *different* user is not. A check that dropped the
 * userId would still pass the 409 case, so the second half is the one doing
 * the work.
 *
 * The second is `delete`. `TaskLabel` cascades from `Label`, so deleting a
 * label silently removes join rows — the intended outcome is that the tasks
 * are *detached* and survive. Getting that wrong destroys user data that
 * cannot be reconstructed, and nothing in the type system says which way it
 * goes, so it is asserted directly.
 */

/** A label owned by `userId`. Local to this file — see the no-shared-fixtures rule. */
async function createLabel(userId: string, name: string, color = '#0f62fe') {
  return prisma.label.create({ data: { userId, name, color } });
}

async function attachLabel(taskId: string, labelId: string) {
  return prisma.taskLabel.create({ data: { taskId, labelId } });
}

describe('labelService.findAll', () => {
  it('returns only the caller’s labels', async () => {
    const { alice, bob } = await createTwoUsers();
    await createLabel(alice.id, 'Alice label');
    await createLabel(bob.id, 'Bob label');

    const labels = await labelService.findAll(alice.id);

    expect(labels.map((l) => l.name)).toEqual(['Alice label']);
  });

  it('orders by name ascending', async () => {
    const { alice } = await createTwoUsers();
    await createLabel(alice.id, 'Zulu');
    await createLabel(alice.id, 'Alpha');
    await createLabel(alice.id, 'Mike');

    const labels = await labelService.findAll(alice.id);

    expect(labels.map((l) => l.name)).toEqual(['Alpha', 'Mike', 'Zulu']);
  });

  it('reports how many tasks carry each label', async () => {
    // The client renders this count next to the label; a count that ignored the
    // join would render every label as empty and make them look safe to delete.
    const { alice } = await createTwoUsers();
    const used = await createLabel(alice.id, 'Used');
    const unused = await createLabel(alice.id, 'Unused');
    const one = await createTask(alice.id, { title: 'One' });
    const two = await createTask(alice.id, { title: 'Two' });
    await attachLabel(one.id, used.id);
    await attachLabel(two.id, used.id);

    const labels = await labelService.findAll(alice.id);
    const byName = Object.fromEntries(labels.map((l) => [l.name, l._count.tasks]));

    expect(byName).toEqual({ Used: 2, Unused: 0 });
  });
});

describe('labelService.create', () => {
  it('creates a label owned by the caller', async () => {
    const { alice } = await createTwoUsers();

    const label = await labelService.create(alice.id, { name: 'Urgent', color: '#da1e28' });

    expect(label.userId).toBe(alice.id);
    expect(label.name).toBe('Urgent');
    expect(label.color).toBe('#da1e28');
  });

  it('rejects a duplicate name for the same user', async () => {
    const { alice } = await createTwoUsers();
    await labelService.create(alice.id, { name: 'Urgent', color: '#da1e28' });

    await expect(labelService.create(alice.id, { name: 'Urgent', color: '#0f62fe' })).rejects.toThrow(
      /already exists/i
    );
    expect(await prisma.label.count({ where: { userId: alice.id } })).toBe(1);
  });

  it('allows two users to own labels with the same name', async () => {
    // Uniqueness is (user_id, name). A duplicate check that forgot the userId
    // would lock every user out of any name another user had already taken.
    const { alice, bob } = await createTwoUsers();
    await labelService.create(alice.id, { name: 'Urgent', color: '#da1e28' });

    const bobLabel = await labelService.create(bob.id, { name: 'Urgent', color: '#0f62fe' });

    expect(bobLabel.userId).toBe(bob.id);
    expect(await prisma.label.count({ where: { name: 'Urgent' } })).toBe(2);
  });
});

describe('labelService.update', () => {
  it('renames a label the caller owns', async () => {
    const { alice } = await createTwoUsers();
    const label = await createLabel(alice.id, 'Old name');

    const updated = await labelService.update(alice.id, label.id, { name: 'New name' });

    expect(updated.name).toBe('New name');
    expect(updated.color).toBe(label.color);
  });

  it('refuses to update another user’s label and leaves it untouched', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobLabel = await createLabel(bob.id, 'Bob only', '#0f62fe');

    await expect(labelService.update(alice.id, bobLabel.id, { name: 'Hijacked' })).rejects.toThrow(
      /not found/i
    );

    const after = await prisma.label.findUniqueOrThrow({ where: { id: bobLabel.id } });
    expect(after.name).toBe('Bob only');
  });

  it('throws 404 for an id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    await expect(
      labelService.update(alice.id, '00000000-0000-0000-0000-000000000000', { name: 'Nope' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects renaming onto a name the caller already uses', async () => {
    const { alice } = await createTwoUsers();
    await createLabel(alice.id, 'Taken');
    const other = await createLabel(alice.id, 'Free');

    await expect(labelService.update(alice.id, other.id, { name: 'Taken' })).rejects.toThrow(
      /already exists/i
    );

    const after = await prisma.label.findUniqueOrThrow({ where: { id: other.id } });
    expect(after.name).toBe('Free');
  });

  it('allows renaming onto a name only another user holds', async () => {
    const { alice, bob } = await createTwoUsers();
    await createLabel(bob.id, 'Shared word');
    const aliceLabel = await createLabel(alice.id, 'Something else');

    const updated = await labelService.update(alice.id, aliceLabel.id, { name: 'Shared word' });

    expect(updated.name).toBe('Shared word');
  });

  it('allows a no-op rename to the label’s current name', async () => {
    // `data.name !== label.name` guards the duplicate check. Without it, saving
    // a colour change without touching the name would 409 against itself.
    const { alice } = await createTwoUsers();
    const label = await createLabel(alice.id, 'Same', '#0f62fe');

    const updated = await labelService.update(alice.id, label.id, { name: 'Same', color: '#da1e28' });

    expect(updated.name).toBe('Same');
    expect(updated.color).toBe('#da1e28');
  });
});

describe('labelService.delete', () => {
  it('detaches the label from its tasks rather than deleting them', async () => {
    // The whole point of this test: `TaskLabel` cascades from `Label`. If that
    // cascade ever reached `Task` — or someone "tidied up" by deleting the
    // labelled tasks — users would lose work with no warning and no undo.
    const { alice } = await createTwoUsers();
    const doomed = await createLabel(alice.id, 'Doomed');
    const keeper = await createLabel(alice.id, 'Keeper');
    const one = await createTask(alice.id, { title: 'Task one' });
    const two = await createTask(alice.id, { title: 'Task two' });
    await attachLabel(one.id, doomed.id);
    await attachLabel(two.id, doomed.id);
    await attachLabel(one.id, keeper.id);

    await labelService.delete(alice.id, doomed.id);

    const tasks = await prisma.task.findMany({ where: { userId: alice.id }, orderBy: { title: 'asc' } });
    expect(tasks.map((t) => t.title)).toEqual(['Task one', 'Task two']);

    // Only the join rows for the deleted label go; the other label stays attached.
    const joins = await prisma.taskLabel.findMany();
    expect(joins).toEqual([{ taskId: one.id, labelId: keeper.id }]);
  });

  it('refuses to delete another user’s label and leaves it in place', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobLabel = await createLabel(bob.id, 'Bob only');

    await expect(labelService.delete(alice.id, bobLabel.id)).rejects.toThrow(/not found/i);

    expect(await prisma.label.findUnique({ where: { id: bobLabel.id } })).not.toBeNull();
  });

  it('does not touch another user’s tasks when deleting a label', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceLabel = await createLabel(alice.id, 'Alice label');
    const aliceTask = await createTask(alice.id, { title: 'Alice task' });
    await attachLabel(aliceTask.id, aliceLabel.id);
    const bobLabel = await createLabel(bob.id, 'Bob label');
    const bobTask = await createTask(bob.id, { title: 'Bob task' });
    await attachLabel(bobTask.id, bobLabel.id);

    await labelService.delete(alice.id, aliceLabel.id);

    expect(await prisma.label.findUnique({ where: { id: bobLabel.id } })).not.toBeNull();
    expect(await prisma.taskLabel.findMany({ where: { labelId: bobLabel.id } })).toHaveLength(1);
    expect(await prisma.task.count({ where: { userId: bob.id } })).toBe(1);
  });

  it('throws 404 for an id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    await expect(
      labelService.delete(alice.id, '00000000-0000-0000-0000-000000000000')
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
