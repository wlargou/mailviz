import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { getGmailClient } from '../lib/gmail.js';
import { createUser, createGoogleAuth } from '../test/factories.js';
import { createGmailMock, type GmailMock } from '../test/gmailMock.js';
import { emailService, INTERRUPTED_SEND_MESSAGE, SCHEDULED_SEND_STUCK_MS } from './emailService.js';

/**
 * Scheduled send, when more than one process — or one process twice — is at it.
 *
 * The job read the due rows, sent them, then marked them sent. Two processes on
 * the same database (an overlapping deploy, a second pod, staging on a copy)
 * sent every due email twice, and so did one process restarted between Gmail
 * accepting a message and the `sent` write. These are emails to customers: a
 * duplicate cannot be recalled.
 *
 * The fix is a claim, `pending` → `sending` in one conditional UPDATE, plus a
 * sweep that fails — and never resends — a row left `sending` by a process
 * that died mid-send. Gmail is faked at `lib/gmail.ts`, the one seam every send
 * goes through; the database is real, because the claim IS a database property.
 */

vi.mock('../lib/gmail.js', () => ({ getGmailClient: vi.fn() }));

let gmail: GmailMock;

beforeEach(() => {
  gmail = createGmailMock();
  vi.mocked(getGmailClient).mockResolvedValue(gmail.client);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function connected() {
  const user = await createUser();
  await createGoogleAuth(user.id, { email: 'me@example.com' });
  return user;
}

async function createScheduled(userId: string, overrides: { status?: string; retryCount?: number; sendAt?: Date } = {}) {
  return prisma.scheduledEmail.create({
    data: {
      userId,
      mode: 'new',
      to: ['client@customer.test'],
      subject: 'Proposal',
      htmlBody: '<p>As discussed.</p>',
      sendAt: overrides.sendAt ?? new Date(Date.now() - 1000),
      status: overrides.status ?? 'pending',
      retryCount: overrides.retryCount ?? 0,
    },
  });
}

/** Put a row's claim time in the past — Prisma would stamp `updatedAt` itself. */
async function claimedAgo(id: string, ms: number) {
  await prisma.$executeRaw`UPDATE scheduled_emails SET updated_at = ${new Date(Date.now() - ms)} WHERE id = ${id}`;
}

const row = (id: string) => prisma.scheduledEmail.findUniqueOrThrow({ where: { id } });

describe('processScheduledEmails — the claim', () => {
  it('sends a due email once when two ticks run at the same moment — REGRESSION', async () => {
    const user = await connected();
    const scheduled = await createScheduled(user.id);
    // Both ticks read the row as pending before either claims it — the overlap
    // two processes on one cron schedule produce. Left to the connection pool,
    // the first tick usually claims before the second has read, and the test
    // passes with no claim at all.
    const realFindMany = prisma.scheduledEmail.findMany.bind(prisma.scheduledEmail);
    let reads = 0;
    let bothRead!: () => void;
    const barrier = new Promise<void>((resolve) => { bothRead = resolve; });
    vi.spyOn(prisma.scheduledEmail, 'findMany').mockImplementation((async (args: Parameters<typeof realFindMany>[0]) => {
      const rows = await realFindMany(args);
      if (++reads === 2) bothRead();
      await barrier;
      return rows;
    }) as unknown as typeof prisma.scheduledEmail.findMany);

    const counts = await Promise.all([
      emailService.processScheduledEmails(),
      emailService.processScheduledEmails(),
    ]);

    expect(gmail.messagesSend).toHaveBeenCalledTimes(1);
    expect(counts[0] + counts[1]).toBe(1);
    expect(await row(scheduled.id)).toMatchObject({ status: 'sent', sentMessageId: 'sent-msg' });
  });

  it('does not send a row another process claimed after this one read it', async () => {
    // The deterministic half of the race above: this tick's read still says
    // pending, but by the time it claims, someone else has. Without the
    // `status: 'pending'` condition on the claim it sends anyway.
    const user = await connected();
    const scheduled = await createScheduled(user.id);
    const realFindMany = prisma.scheduledEmail.findMany.bind(prisma.scheduledEmail);
    vi.spyOn(prisma.scheduledEmail, 'findMany').mockImplementationOnce((async (args: Parameters<typeof realFindMany>[0]) => {
      const stale = await realFindMany(args);
      await prisma.scheduledEmail.update({ where: { id: scheduled.id }, data: { status: 'sending' } });
      return stale;
    }) as unknown as typeof prisma.scheduledEmail.findMany);

    expect(await emailService.processScheduledEmails()).toBe(0);

    expect(gmail.messagesSend).not.toHaveBeenCalled();
    // Left exactly as the other process holds it: neither sent nor failed here.
    expect(await row(scheduled.id)).toMatchObject({ status: 'sending', retryCount: 0 });
  });

  it('does not send a row rescheduled into the future after this tick read it', async () => {
    const user = await connected();
    const scheduled = await createScheduled(user.id);
    const later = new Date(Date.now() + 3_600_000);
    const realFindMany = prisma.scheduledEmail.findMany.bind(prisma.scheduledEmail);
    vi.spyOn(prisma.scheduledEmail, 'findMany').mockImplementationOnce((async (args: Parameters<typeof realFindMany>[0]) => {
      const stale = await realFindMany(args);
      await prisma.scheduledEmail.update({ where: { id: scheduled.id }, data: { sendAt: later } });
      return stale;
    }) as unknown as typeof prisma.scheduledEmail.findMany);

    await emailService.processScheduledEmails();

    expect(gmail.messagesSend).not.toHaveBeenCalled();
    expect(await row(scheduled.id)).toMatchObject({ status: 'pending', sendAt: later });
  });

  it('puts a failed send back to pending for the next tick, and fails it on the third', async () => {
    // The failure semantics from before the claim, kept: a Gmail error is
    // retried twice more. Left in `sending`, it would wait out the sweep
    // instead and never be retried at all.
    const user = await connected();
    const first = await createScheduled(user.id);
    const third = await createScheduled(user.id, { retryCount: 2 });
    gmail.messagesSend.mockRejectedValue(new Error('Gmail said no'));

    await emailService.processScheduledEmails();

    expect(await row(first.id)).toMatchObject({ status: 'pending', retryCount: 1, errorMessage: 'Gmail said no' });
    expect(await row(third.id)).toMatchObject({ status: 'failed', retryCount: 3 });
  });

  it('leaves a send failed when the sweep gave up on it while it was in flight', async () => {
    // Another process's sweep can fail a row this one is still sending. If the
    // send then errors, putting it back to pending queues a send nobody can
    // rule out has already happened.
    const user = await connected();
    const scheduled = await createScheduled(user.id);
    gmail.messagesSend.mockImplementation(async () => {
      await prisma.scheduledEmail.update({ where: { id: scheduled.id }, data: { status: 'failed', errorMessage: INTERRUPTED_SEND_MESSAGE } });
      throw new Error('socket hang up');
    });

    await emailService.processScheduledEmails();

    expect(await row(scheduled.id)).toMatchObject({ status: 'failed', errorMessage: INTERRUPTED_SEND_MESSAGE });
  });

  it('records a send that succeeded even if the sweep had given up on it', async () => {
    // The opposite case: Gmail took it, so `sent` is the truth whatever the
    // sweep guessed.
    const user = await connected();
    const scheduled = await createScheduled(user.id);
    gmail.messagesSend.mockImplementation(async () => {
      await prisma.scheduledEmail.update({ where: { id: scheduled.id }, data: { status: 'failed' } });
      return { data: { id: 'sent-msg', threadId: 'thread-sent' } };
    });

    expect(await emailService.processScheduledEmails()).toBe(1);

    expect(await row(scheduled.id)).toMatchObject({ status: 'sent', sentMessageId: 'sent-msg' });
  });
});

describe('processScheduledEmails — the sweep', () => {
  it('fails a send interrupted mid-way, and never sends it again', async () => {
    // A process killed between its claim and its `sent` write leaves the row
    // `sending`. Gmail may well have accepted the message, so the only safe
    // outcome is failed, with a message saying to check Sent — on this tick
    // and every one after.
    const user = await connected();
    const scheduled = await createScheduled(user.id, { status: 'sending' });
    await claimedAgo(scheduled.id, SCHEDULED_SEND_STUCK_MS + 60_000);

    await emailService.processScheduledEmails();
    await emailService.processScheduledEmails();

    expect(gmail.messagesSend).not.toHaveBeenCalled();
    expect(await row(scheduled.id)).toMatchObject({ status: 'failed', errorMessage: INTERRUPTED_SEND_MESSAGE });
  });

  it('leaves alone a send claimed a moment ago, which may still be in flight elsewhere', async () => {
    const user = await connected();
    const scheduled = await createScheduled(user.id, { status: 'sending' });
    await claimedAgo(scheduled.id, 2 * 60_000);

    await emailService.processScheduledEmails();

    expect(gmail.messagesSend).not.toHaveBeenCalled();
    expect(await row(scheduled.id)).toMatchObject({ status: 'sending', errorMessage: null });
  });
});

describe('a scheduled email that is being sent', () => {
  it('is listed, as sending', async () => {
    // It used to drop out of the Scheduled folder for the length of the send,
    // which reads as lost.
    const user = await connected();
    const sending = await createScheduled(user.id, { status: 'sending' });
    const pending = await createScheduled(user.id);
    await createScheduled(user.id, { status: 'sent' });
    await createScheduled(user.id, { status: 'cancelled' });

    const listed = await emailService.getScheduledEmails(user.id);

    expect(listed.map((s) => s.id).sort()).toEqual([pending.id, sending.id].sort());
  });

  it('cannot be cancelled', async () => {
    const user = await connected();
    const scheduled = await createScheduled(user.id, { status: 'sending' });

    await expect(emailService.cancelScheduledEmail(user.id, scheduled.id)).rejects.toMatchObject({ status: 409 });

    expect((await row(scheduled.id)).status).toBe('sending');
  });

  it('cannot be rescheduled', async () => {
    const user = await connected();
    const scheduled = await createScheduled(user.id, { status: 'sending' });

    await expect(
      emailService.updateScheduledEmail(user.id, scheduled.id, { sendAt: new Date(Date.now() + 3_600_000).toISOString() })
    ).rejects.toMatchObject({ status: 409 });

    expect((await row(scheduled.id)).sendAt.getTime()).toBe(scheduled.sendAt.getTime());
  });

  it('cannot be rescheduled by a request that read it a moment before the claim', async () => {
    // The race the conditional write closes: the reschedule's own read says
    // pending, then the scheduler claims the row, then the write lands.
    const user = await connected();
    const scheduled = await createScheduled(user.id);
    const realFindFirst = prisma.scheduledEmail.findFirst.bind(prisma.scheduledEmail);
    vi.spyOn(prisma.scheduledEmail, 'findFirst').mockImplementationOnce((async (args: Parameters<typeof realFindFirst>[0]) => {
      const stale = await realFindFirst(args);
      await prisma.scheduledEmail.update({ where: { id: scheduled.id }, data: { status: 'sending' } });
      return stale;
    }) as unknown as typeof prisma.scheduledEmail.findFirst);

    await expect(
      emailService.updateScheduledEmail(user.id, scheduled.id, { sendAt: new Date(Date.now() + 3_600_000).toISOString() })
    ).rejects.toMatchObject({ status: 409 });

    expect((await row(scheduled.id)).sendAt.getTime()).toBe(scheduled.sendAt.getTime());
  });

  it('still answers 404 for another account’s row, not 409', async () => {
    // The conditional write carries the owner too; a miss must not tell the
    // caller what state somebody else's email is in.
    const user = await connected();
    const other = await connected();
    const theirs = await createScheduled(other.id, { status: 'sending' });

    await expect(emailService.cancelScheduledEmail(user.id, theirs.id)).rejects.toMatchObject({ status: 404 });
  });
});
