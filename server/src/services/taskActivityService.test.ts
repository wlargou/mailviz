import { describe, it, expect } from 'vitest';
import { taskActivityService } from './taskActivityService.js';
import { taskService } from './taskService.js';
import { auditService } from './auditService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createUser, createTask, createCustomer, shareTaskWith } from '../test/factories.js';

/**
 * A task's timeline and its comments.
 *
 * Two things carry the design. The timeline reads the audit log across users
 * — a share recipient's edit appears on the owner's task — so the access
 * check is the task's, and a stranger gets nothing. And a mention is a
 * notification: the ids are validated to real users other than the author,
 * and nobody is told twice about one comment.
 */
describe('taskActivityService — timeline', () => {
  it('lists what happened to the task, whoever did it, newest first', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await taskService.create(alice.id, { title: 'Renew', status: 'TODO' });
    await shareTaskWith(task.id, alice.id, bob.id);
    await taskService.update(bob.id, task.id, { status: 'DONE' });
    await auditService.flush();

    const { data } = await taskActivityService.listActivity(alice.id, task.id);

    expect(data.map((e) => (e.kind === 'event' ? e.action : 'comment'))).toEqual(['TASK_UPDATED', 'TASK_CREATED']);
    const update = data[0];
    expect(update.kind).toBe('event');
    if (update.kind !== 'event') throw new Error('unreachable');
    // Bob's edit, on Alice's task, with the values — not just the key.
    expect(update.actor.id).toBe(bob.id);
    expect(update.details).toMatchObject({ changes: ['status'], from: { status: 'TODO' }, to: { status: 'DONE' } });
  });

  it('is scoped by the task\'s access, not by who wrote the rows — REGRESSION guard', async () => {
    // `auditService.findAll` filters by the caller's userId. Reusing that
    // here would show the owner only their own edits and a stranger nothing
    // either way; the timeline must instead be gated by the task.
    const { alice, bob } = await createTwoUsers();
    const stranger = await createUser();
    const task = await taskService.create(alice.id, { title: 'Private' });
    await taskService.update(alice.id, task.id, { title: 'Private, renamed' });
    await auditService.flush();

    await expect(taskActivityService.listActivity(stranger.id, task.id)).rejects.toMatchObject({ statusCode: 404 });

    await shareTaskWith(task.id, alice.id, bob.id);
    const { data } = await taskActivityService.listActivity(bob.id, task.id);
    expect(data.length).toBeGreaterThanOrEqual(2);
    expect(data.every((e) => e.kind === 'comment' || e.actor.id === alice.id)).toBe(true);
  });

  it('interleaves comments with events by time and hides the comment audit rows', async () => {
    const { alice } = await createTwoUsers();
    const task = await taskService.create(alice.id, { title: 'Discuss' });
    await taskActivityService.addComment(alice.id, task.id, { body: 'First thought' });
    await taskService.update(alice.id, task.id, { priority: 'HIGH' });
    await auditService.flush();

    const { data } = await taskActivityService.listActivity(alice.id, task.id);

    const kinds = data.map((e) => (e.kind === 'event' ? e.action : `comment:${(e as { body: string }).body}`));
    expect(kinds).toEqual(['TASK_UPDATED', 'comment:First thought', 'TASK_CREATED']);
    // The TASK_COMMENTED audit row exists, for the Activity page, but is not a
    // second line in the timeline.
    expect(await prisma.auditLog.count({ where: { entityId: task.id, action: 'TASK_COMMENTED' } })).toBe(1);
  });

  it('records what changed with before and after values', async () => {
    const { alice } = await createTwoUsers();
    const acme = await createCustomer(alice.id, { name: 'Acme' });
    const task = await taskService.create(alice.id, { title: 'Old title', priority: 'LOW' });

    await taskService.update(alice.id, task.id, {
      title: 'New title',
      priority: 'URGENT',
      customerId: acme.id,
      dueDate: '2026-10-01T00:00:00.000Z',
      // Unchanged: must NOT be reported as a change.
      status: 'TODO',
    });
    await auditService.flush();

    const row = await prisma.auditLog.findFirst({ where: { entityId: task.id, action: 'TASK_UPDATED' } });
    const details = row!.details as { changes: string[]; from: Record<string, unknown>; to: Record<string, unknown> };
    expect(details.changes.sort()).toEqual(['customerId', 'dueDate', 'priority', 'title']);
    expect(details.from).toMatchObject({ title: 'Old title', priority: 'LOW', customerId: null });
    expect(details.to).toMatchObject({ title: 'New title', priority: 'URGENT', customerId: acme.id, customer: 'Acme', dueDate: '2026-10-01T00:00:00.000Z' });
  });
});

describe('taskActivityService — comments', () => {
  it('a share recipient can comment; a stranger cannot', async () => {
    const { alice, bob } = await createTwoUsers();
    const stranger = await createUser();
    const task = await createTask(alice.id);

    await expect(
      taskActivityService.addComment(stranger.id, task.id, { body: 'Hello?' })
    ).rejects.toMatchObject({ statusCode: 404 });

    await shareTaskWith(task.id, alice.id, bob.id);
    const comment = await taskActivityService.addComment(bob.id, task.id, { body: 'On it' });
    expect(comment.user.id).toBe(bob.id);
    expect(comment.body).toBe('On it');
  });

  it('mentions notify the people named, once, and never the author', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    const task = await createTask(alice.id, { title: 'Renew' });
    await shareTaskWith(task.id, alice.id, bob.id);

    const comment = await taskActivityService.addComment(bob.id, task.id, {
      body: '@Alice @Carol can one of you take this?',
      // Alice twice, Bob (the author), Carol, and an id that is nobody.
      mentions: [alice.id, alice.id, bob.id, carol.id, '00000000-0000-4000-8000-000000000000'],
    });

    expect(comment.mentions.sort()).toEqual([alice.id, carol.id].sort());

    const forAlice = await prisma.notification.findMany({ where: { userId: alice.id, entityId: task.id } });
    // Alice is the owner AND mentioned: one notification, as a mention, not
    // one as a mention and another as a comment on her task.
    expect(forAlice.map((n) => n.type)).toEqual(['TASK_MENTIONED']);
    expect(forAlice[0].title).toContain('Bob mentioned you');

    const forCarol = await prisma.notification.findMany({ where: { userId: carol.id } });
    expect(forCarol.map((n) => n.type)).toEqual(['TASK_MENTIONED']);

    expect(await prisma.notification.count({ where: { userId: bob.id } })).toBe(0);
  });

  it('the owner and the assignee hear about a comment they are not named in', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    const task = await createTask(alice.id, { title: 'Renew', assignedToId: carol.id });
    await shareTaskWith(task.id, alice.id, bob.id);

    await taskActivityService.addComment(bob.id, task.id, { body: 'Done my part' });

    for (const recipient of [alice, carol]) {
      const n = await prisma.notification.findMany({ where: { userId: recipient.id, entityId: task.id } });
      expect(n.map((x) => x.type)).toEqual(['TASK_COMMENTED']);
      expect(n[0].message).toContain('Bob commented: Done my part');
    }
    expect(await prisma.notification.count({ where: { userId: bob.id } })).toBe(0);
  });

  it('the author commenting on their own task notifies nobody', async () => {
    const { alice } = await createTwoUsers();
    const task = await createTask(alice.id);

    await taskActivityService.addComment(alice.id, task.id, { body: 'Note to self' });

    expect(await prisma.notification.count()).toBe(0);
  });

  it('only the author can edit, and an edit tells only the newly mentioned', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    const task = await createTask(alice.id);
    await shareTaskWith(task.id, alice.id, bob.id);
    const comment = await taskActivityService.addComment(alice.id, task.id, { body: '@Bob look', mentions: [bob.id] });

    await expect(
      taskActivityService.updateComment(bob.id, task.id, comment.id, { body: 'hijacked' })
    ).rejects.toMatchObject({ statusCode: 404 });

    const edited = await taskActivityService.updateComment(alice.id, task.id, comment.id, {
      body: '@Bob @Carol look',
      mentions: [bob.id, carol.id],
    });
    expect(edited.editedAt).not.toBeNull();
    expect(edited.body).toBe('@Bob @Carol look');

    expect(await prisma.notification.count({ where: { userId: bob.id, type: 'TASK_MENTIONED' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: carol.id, type: 'TASK_MENTIONED' } })).toBe(1);
  });

  it('the author or the task owner can delete; a share recipient cannot delete another\'s', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser();
    const task = await createTask(alice.id);
    await shareTaskWith(task.id, alice.id, bob.id);
    await shareTaskWith(task.id, alice.id, carol.id);
    const bobs = await taskActivityService.addComment(bob.id, task.id, { body: 'mine' });
    const carols = await taskActivityService.addComment(carol.id, task.id, { body: 'also mine' });

    await expect(taskActivityService.deleteComment(carol.id, task.id, bobs.id)).rejects.toMatchObject({ statusCode: 404 });
    await taskActivityService.deleteComment(bob.id, task.id, bobs.id);
    await taskActivityService.deleteComment(alice.id, task.id, carols.id);

    expect(await prisma.taskComment.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('a comment id from another task is a 404 — REGRESSION guard', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createTask(alice.id);
    const bobs = await createTask(bob.id);
    const bobsComment = await taskActivityService.addComment(bob.id, bobs.id, { body: 'BobsSecretComment' });

    await expect(
      taskActivityService.updateComment(alice.id, mine.id, bobsComment.id, { body: 'x' })
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(taskActivityService.deleteComment(alice.id, mine.id, bobsComment.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect((await prisma.taskComment.findUniqueOrThrow({ where: { id: bobsComment.id } })).body).toBe('BobsSecretComment');
  });

  it('comments go with the task', async () => {
    const { alice } = await createTwoUsers();
    const task = await createTask(alice.id);
    const c = await taskActivityService.addComment(alice.id, task.id, { body: 'x' });

    await taskService.delete(alice.id, task.id);

    expect(await prisma.taskComment.findUnique({ where: { id: c.id } })).toBeNull();
  });
});
