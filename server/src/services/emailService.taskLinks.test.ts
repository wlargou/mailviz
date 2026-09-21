import { describe, it, expect } from 'vitest';
import { emailService } from './emailService.js';
import { taskService } from './taskService.js';
import { taskActivityService } from './taskActivityService.js';
import { auditService } from './auditService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createUser, createTask, createEmail, createCustomer, shareThreadWith, shareTaskWith } from '../test/factories.js';

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

  /**
   * The convert form carries every task field. These run through
   * `taskService.create`, which is the only way labels get linked and the
   * only place the ownership and date-order rules live — the previous raw
   * insert had none of them, so a body with `labelIds` was silently a task
   * with no labels.
   */
  describe('convert — the full task form', () => {
    it('links labels, keeps the estimate and dates, and reads the description back', async () => {
      const { alice } = await createTwoUsers();
      const label = await prisma.label.create({ data: { userId: alice.id, name: 'Sales', color: '#0f62fe' } });
      const email = await createEmail(alice.id, { subject: 'Quote', snippet: 'Please send the quote' });

      const task = await emailService.convertToTask(email.id, {
        description: 'Typed instead',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        dueDate: '2026-10-01T09:00:00.000Z',
        startDate: '2026-09-28T09:00:00.000Z',
        remindAt: '2026-09-30T09:00:00.000Z',
        labelIds: [label.id],
        estimatedMinutes: 30,
        recurrence: 'RRULE:FREQ=WEEKLY',
        notes: 'From the thread',
      }, alice.id);

      const stored = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, include: { labels: true } });
      expect(stored).toMatchObject({
        title: 'Quote',
        description: 'Typed instead',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        estimatedMinutes: 30,
        recurrence: 'RRULE:FREQ=WEEKLY',
        dueDate: new Date('2026-10-01T09:00:00.000Z'),
        startDate: new Date('2026-09-28T09:00:00.000Z'),
        remindAt: new Date('2026-09-30T09:00:00.000Z'),
      });
      expect(stored.labels.map((l) => l.labelId)).toEqual([label.id]);
      expect(await prisma.mailToTask.findFirst({ where: { taskId: task.id } })).toMatchObject({ emailId: email.id, conversionNote: 'From the thread' });
    });

    it('falls back to the email\'s snippet for the description only when none was typed', async () => {
      const { alice } = await createTwoUsers();
      const email = await createEmail(alice.id, { subject: 'Quote', snippet: 'Tom &amp; Jerry' });

      const fallback = await emailService.convertToTask(email.id, {}, alice.id);
      expect(fallback.description).toBe('Tom & Jerry');

      const typed = await emailService.convertToTask(email.id, { description: '' }, alice.id);
      // Not the snippet: an empty box is an answer, the same as in the task form.
      expect(typed.description).toBeNull();
    });

    it('defaults the company to the email\'s, but an explicit choice wins — including "none"', async () => {
      const { alice } = await createTwoUsers();
      const acme = await createCustomer(alice.id, { name: 'Acme' });
      const globex = await createCustomer(alice.id, { name: 'Globex' });
      const email = await createEmail(alice.id, { customerId: acme.id });

      expect((await emailService.convertToTask(email.id, {}, alice.id)).customerId).toBe(acme.id);
      expect((await emailService.convertToTask(email.id, { customerId: globex.id }, alice.id)).customerId).toBe(globex.id);
      expect((await emailService.convertToTask(email.id, { customerId: null }, alice.id)).customerId).toBeNull();
    });

    it('enforces the task rules: a stranger\'s label or company, a start after the due date, a repeat without a due date', async () => {
      const { alice, bob } = await createTwoUsers();
      const email = await createEmail(alice.id);
      const bobsLabel = await prisma.label.create({ data: { userId: bob.id, name: 'Private', color: '#000000' } });
      const bobsCustomer = await createCustomer(bob.id);

      await expect(emailService.convertToTask(email.id, { labelIds: [bobsLabel.id] }, alice.id)).rejects.toMatchObject({ statusCode: 404, code: 'LABEL_NOT_FOUND' });
      await expect(emailService.convertToTask(email.id, { customerId: bobsCustomer.id }, alice.id)).rejects.toMatchObject({ statusCode: 404, code: 'CUSTOMER_NOT_FOUND' });
      await expect(emailService.convertToTask(email.id, {
        startDate: '2026-10-02T09:00:00.000Z', dueDate: '2026-10-01T09:00:00.000Z',
      }, alice.id)).rejects.toMatchObject({ statusCode: 400, code: 'START_AFTER_DUE' });
      await expect(emailService.convertToTask(email.id, { recurrence: 'RRULE:FREQ=WEEKLY' }, alice.id)).rejects.toMatchObject({ statusCode: 400, code: 'RECURRENCE_NEEDS_DUE_DATE' });

      // Every refusal happened before anything was written: no half-made task, no dangling link.
      expect(await prisma.task.count({ where: { userId: alice.id } })).toBe(0);
      expect(await prisma.mailToTask.count()).toBe(0);
    });
  });
});
