import { describe, it, expect } from 'vitest';
import { emailService } from './emailService.js';
import { taskService } from './taskService.js';
import { taskActivityService } from './taskActivityService.js';
import { auditService } from './auditService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createUser, createTask, createEmail, shareThreadWith, shareTaskWith } from '../test/factories.js';

/**
 * Email ↔ task, many-to-many.
 *
 * One email may produce several tasks and a task may cite several emails.
 * Attaching needs access to both ends; a link whose email is another
 * account's and not shared is refused. And a reply on a linked thread shows
 * up on the task's timeline without anyone opening Mail.
 */
describe('emailService — task links', () => {
  it('an email can be converted more than once, and a task can cite several emails', async () => {
    const { alice } = await createTwoUsers();
    const a = await createEmail(alice.id, { subject: 'Three asks', threadId: 'thr-1' });
    const b = await createEmail(alice.id, { subject: 'Follow-up', threadId: 'thr-1' });

    const t1 = await emailService.convertToTask(a.id, { title: 'Ask one' }, alice.id);
    const t2 = await emailService.convertToTask(a.id, { title: 'Ask two' }, alice.id);
    expect(t1.id).not.toBe(t2.id);

    await emailService.attachToTask(b.id, t1.id, 'Also this', alice.id);
    // Twice is one link.
    await emailService.attachToTask(b.id, t1.id, undefined, alice.id);
    expect(await prisma.mailToTask.count({ where: { taskId: t1.id } })).toBe(2);

    const detail = await taskService.findById(alice.id, t1.id);
    expect(detail.emailLinks.map((l: { email: { subject: string }; conversionNote: string | null }) => [l.email.subject, l.conversionNote])).toEqual([
      ['Three asks', null],
      ['Follow-up', 'Also this'],
    ]);

    await emailService.detachFromTask(b.id, t1.id, alice.id);
    expect((await taskService.findById(alice.id, t1.id)).emailLinks).toHaveLength(1);
    await expect(emailService.detachFromTask(b.id, t1.id, alice.id)).rejects.toMatchObject({ status: 404 });
  });

  it('attaching needs the email and the task — a stranger\'s email is a 404 unless its thread is shared', async () => {
    const { alice, bob } = await createTwoUsers();
    const stranger = await createUser();
    const task = await createTask(alice.id);
    const bobs = await createEmail(bob.id, { subject: 'BobsSecretMail', threadId: 'thr-bob' });

    await expect(emailService.attachToTask(bobs.id, task.id, undefined, alice.id)).rejects.toMatchObject({ status: 404 });
    await shareThreadWith('thr-bob', bob.id, alice.id);
    const link = await emailService.attachToTask(bobs.id, task.id, undefined, alice.id);
    expect(link.taskId).toBe(task.id);

    const mine = await createEmail(alice.id, { subject: 'Mine' });
    await expect(emailService.attachToTask(mine.id, task.id, undefined, stranger.id)).rejects.toMatchObject({ status: 404 });

    // The other end: Bob owns the email but has no access to Alice's task.
    const bobsOther = await createEmail(bob.id, { subject: 'Bob own mail', threadId: 'thr-bob-2' });
    await expect(emailService.attachToTask(bobsOther.id, task.id, undefined, bob.id)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.mailToTask.count()).toBe(1);
  });

  it('a reply on a linked thread appears on the timeline; the linked message itself does not', async () => {
    const { alice, bob } = await createTwoUsers();
    const original = await createEmail(alice.id, { subject: 'Quote request', threadId: 'thr-q', receivedAt: new Date('2026-09-01T09:00:00.000Z') });
    const task = await emailService.convertToTask(original.id, { title: 'Send the quote' }, alice.id);
    // Written before the link, in the same thread: history, not a reply.
    await createEmail(alice.id, { subject: 'Re: Quote request', threadId: 'thr-q', receivedAt: new Date('2026-08-31T09:00:00.000Z') });
    const reply = await createEmail(alice.id, { subject: 'Re: Quote request', threadId: 'thr-q', from: 'sam@acme.test', receivedAt: new Date() });
    await createEmail(alice.id, { subject: 'Unrelated', threadId: 'thr-other', receivedAt: new Date() });
    // Attached later, and dated after the link: a linked message is never
    // also shown as a reply, whatever its date says.
    const attachedLate = await createEmail(alice.id, { subject: 'Re: Quote request (attached)', threadId: 'thr-q', receivedAt: new Date(Date.now() + 60 * 60_000) });
    await emailService.attachToTask(attachedLate.id, task.id, undefined, alice.id);
    await shareTaskWith(task.id, alice.id, bob.id);
    await auditService.flush();

    const { data } = await taskActivityService.listActivity(bob.id, task.id);
    const mails = data.filter((e) => e.kind === 'email');
    expect(mails.map((e) => e.id)).toEqual([reply.id]);
    expect(mails[0]).toMatchObject({ actor: { email: 'sam@acme.test' }, threadId: 'thr-q' });
  });
});
