import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { getGmailClient } from '../lib/gmail.js';
import { snoozeService, MAX_REMINDERS_PER_TICK } from './snoozeService.js';
import { emailService } from './emailService.js';
import { createUser, createTwoUsers, createEmail, createGoogleAuth } from '../test/factories.js';
import {
  createGmailMock,
  historyPage,
  messageAdded,
  modifyParams,
  stubMessagesGet,
  type GmailMock,
} from '../test/gmailMock.js';

/**
 * Snooze and follow-up reminders.
 *
 * Three things make this feature capable of being quietly wrong, and each has
 * its own section below.
 *
 * 1. **The 60-second sync.** `emailService.upsertMessage` rewrites every column
 *    of an `emails` row from Gmail, and the incremental label handlers rewrite
 *    `labelIds` and the flags derived from it. Any snooze that lived on the
 *    email row would be undone within the minute, and the symptom — mail
 *    silently reappearing a minute later — is exactly the kind of thing nobody
 *    reproduces on demand. The sync here is the real one, driven through the
 *    `getGmailClient` seam, so the test proves the row *was* clobbered and the
 *    snooze survived anyway.
 *
 * 2. **Multi-tenancy.** Gmail thread ids are not ours, and two users on the
 *    same conversation legitimately hold rows with the same `threadId`. A
 *    hiding filter that forgot `userId` would hide one person's mail because a
 *    colleague snoozed theirs.
 *
 * 3. **Reviving what the user already dealt with.** A snooze that fires and
 *    fishes a thread back out of the trash is worse than no snooze at all.
 *
 * Cases marked `— REGRESSION` name the specific bug they hold shut.
 */

vi.mock('../lib/gmail.js', () => ({ getGmailClient: vi.fn() }));

let gmail: GmailMock;

beforeEach(() => {
  gmail = createGmailMock();
  vi.mocked(getGmailClient).mockResolvedValue(gmail.client);
});

afterEach(() => {
  vi.mocked(getGmailClient).mockReset();
});

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);
const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

/** The thread ids the mail list would render for this user, in one call. */
async function visibleThreadIds(userId: string, folder?: string): Promise<string[]> {
  const result = await emailService.findAllThreads(folder ? { folder } : {}, userId);
  return result.data.map((t) => t.threadId).filter((id): id is string => id !== null);
}

/** Arm a snooze directly in the past, which the service refuses to do. */
async function armOverdue(
  userId: string,
  threadId: string,
  kind: 'snooze' | 'follow_up',
  overrides: Partial<{ armedAt: Date; wasInInbox: boolean; remindAt: Date }> = {}
) {
  return prisma.emailReminder.create({
    data: {
      userId,
      threadId,
      kind,
      remindAt: overrides.remindAt ?? anHourAgo(),
      armedAt: overrides.armedAt ?? anHourAgo(),
      wasInInbox: overrides.wasInInbox ?? true,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Surviving the sync
// ─────────────────────────────────────────────────────────────────────────────

describe('snooze vs the Gmail sync', () => {
  /**
   * — REGRESSION —
   *
   * The failure this locks down: a snooze that the background sync silently
   * undoes. Gmail has no snooze API, so whatever hides the thread has to be
   * ours; and everything of ours that lives on the `emails` row is rewritten
   * from Gmail every 60 seconds by design.
   *
   * The sync below is genuine — `syncFromGmail` on the incremental path,
   * fetching the message back with Gmail's INBOX label and running the real
   * `upsertMessage`. The first assertion proves the row really was overwritten
   * (labels back to INBOX, `isArchived` back to false); the rest prove the
   * thread is still hidden and the reminder still armed, because the state that
   * hides it is in a table the sync has no reason to write to.
   */
  it('— REGRESSION: a snooze survives a sync cycle that rewrites the email row', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { lastHistoryId: '100' });
    const email = await createEmail(user.id, {
      gmailMessageId: 'msg-snoozed',
      threadId: 'thread-msg-snoozed',
      labelIds: ['INBOX', 'UNREAD'],
    });

    await snoozeService.create(user.id, {
      threadId: email.threadId!,
      kind: 'snooze',
      remindAt: inAnHour(),
    });

    // Snoozing dropped INBOX locally and in Gmail.
    const afterSnooze = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(afterSnooze.labelIds).not.toContain('INBOX');
    expect(afterSnooze.isArchived).toBe(true);
    expect(await visibleThreadIds(user.id)).not.toContain(email.threadId);

    // Now Gmail hands the message straight back with INBOX on it — the exact
    // shape of "the sync overwrites local rows every 60 seconds".
    gmail.historyList.mockResolvedValue(historyPage([messageAdded('msg-snoozed')]));
    stubMessagesGet(gmail, [
      { id: 'msg-snoozed', threadId: 'thread-msg-snoozed', labelIds: ['INBOX', 'UNREAD'] },
    ]);
    await emailService.syncFromGmail(user.id);

    // The row WAS clobbered — this is the assertion that makes the rest mean
    // something.
    const afterSync = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(afterSync.labelIds).toContain('INBOX');
    expect(afterSync.isArchived).toBe(false);

    // …and the snooze is untouched.
    const reminder = await prisma.emailReminder.findFirstOrThrow({ where: { userId: user.id } });
    expect(reminder.state).toBe('armed');
    expect(await visibleThreadIds(user.id)).not.toContain(email.threadId);
    expect(await visibleThreadIds(user.id, 'snoozed')).toContain(email.threadId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Multi-tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('snooze isolation', () => {
  it('a user cannot snooze a thread they do not own', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceEmail = await createEmail(alice.id, { threadId: 'thread-alice-only' });

    await expect(
      snoozeService.create(bob.id, {
        threadId: aliceEmail.threadId!,
        kind: 'snooze',
        remindAt: inAnHour(),
      })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(await prisma.emailReminder.count()).toBe(0);
    expect(await visibleThreadIds(alice.id)).toContain('thread-alice-only');
  });

  it('a user cannot cancel somebody else’s reminder', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 'thread-alice-2' });
    const reminder = await snoozeService.create(alice.id, {
      threadId: 'thread-alice-2',
      kind: 'snooze',
      remindAt: inAnHour(),
    });

    await expect(snoozeService.cancel(bob.id, reminder.id)).rejects.toMatchObject({
      statusCode: 404,
    });

    const still = await prisma.emailReminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(still.state).toBe('armed');
  });

  /**
   * — REGRESSION —
   *
   * Two people on the same conversation hold rows with the same Gmail
   * `threadId`; that is normal, not a collision. If `snoozedThreadIds` were
   * ever written without its `userId` filter, Alice snoozing her copy would
   * make Bob's copy disappear from his inbox — a cross-tenant leak in the
   * "hides other people's data" direction, which is quieter and lasts longer
   * than the "shows other people's data" direction this suite usually hunts.
   */
  it('— REGRESSION: one user’s snooze does not hide another user’s copy of the same thread', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = 'thread-shared-gmail-id';
    await createEmail(alice.id, { threadId: shared, gmailMessageId: 'a-1' });
    await createEmail(bob.id, { threadId: shared, gmailMessageId: 'b-1' });

    await snoozeService.create(alice.id, { threadId: shared, kind: 'snooze', remindAt: inAnHour() });

    expect(await visibleThreadIds(alice.id)).not.toContain(shared);
    expect(await visibleThreadIds(bob.id)).toContain(shared);
    expect(await snoozeService.snoozedThreadIds(bob.id)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Hiding and the Snoozed folder
// ─────────────────────────────────────────────────────────────────────────────

describe('the Snoozed folder', () => {
  it('hides the thread from the default list and shows it under folder=snoozed', async () => {
    const user = await createUser();
    await createEmail(user.id, { threadId: 'thread-hidden', labelIds: ['INBOX'] });
    await createEmail(user.id, { threadId: 'thread-visible', labelIds: ['INBOX'] });

    await snoozeService.create(user.id, {
      threadId: 'thread-hidden',
      kind: 'snooze',
      remindAt: inAnHour(),
    });

    expect(await visibleThreadIds(user.id)).toEqual(['thread-visible']);
    expect(await visibleThreadIds(user.id, 'inbox')).toEqual(['thread-visible']);
    expect(await visibleThreadIds(user.id, 'archived')).toEqual([]);
    expect(await visibleThreadIds(user.id, 'snoozed')).toEqual(['thread-hidden']);
  });

  /**
   * A thread the user throws away while it is snoozed must not vanish from
   * Trash as well — that is two disappearances for one action, and the second
   * one has no undo the user can find.
   */
  it('still shows a snoozed thread in Trash once it is trashed', async () => {
    const user = await createUser();
    const email = await createEmail(user.id, { threadId: 'thread-binned', labelIds: ['INBOX'] });
    await snoozeService.create(user.id, {
      threadId: 'thread-binned',
      kind: 'snooze',
      remindAt: inAnHour(),
    });
    await emailService.trash(email.id, user.id);

    expect(await visibleThreadIds(user.id)).toEqual([]);
    expect(await visibleThreadIds(user.id, 'trash')).toEqual(['thread-binned']);
  });

  it('a follow-up hides nothing', async () => {
    const user = await createUser();
    await createEmail(user.id, { threadId: 'thread-followed', labelIds: ['INBOX'] });

    await snoozeService.create(user.id, {
      threadId: 'thread-followed',
      kind: 'follow_up',
      remindAt: inAnHour(),
    });

    expect(await visibleThreadIds(user.id)).toEqual(['thread-followed']);
    expect(await snoozeService.snoozedThreadIds(user.id)).toEqual([]);
  });

  it('refuses a reminder in the past', async () => {
    const user = await createUser();
    await createEmail(user.id, { threadId: 'thread-past' });

    await expect(
      snoozeService.create(user.id, {
        threadId: 'thread-past',
        kind: 'snooze',
        remindAt: anHourAgo(),
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('re-snoozing replaces the pending reminder instead of stacking another', async () => {
    const user = await createUser();
    await createEmail(user.id, { threadId: 'thread-resnooze', labelIds: ['INBOX'] });

    const first = await snoozeService.create(user.id, {
      threadId: 'thread-resnooze',
      kind: 'snooze',
      remindAt: inAnHour(),
    });
    await snoozeService.create(user.id, {
      threadId: 'thread-resnooze',
      kind: 'snooze',
      remindAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    const armed = await prisma.emailReminder.findMany({
      where: { userId: user.id, state: 'armed' },
    });
    expect(armed).toHaveLength(1);
    expect(armed[0].id).not.toBe(first.id);
    expect((await prisma.emailReminder.findUniqueOrThrow({ where: { id: first.id } })).resolution)
      .toBe('replaced');
  });

  /**
   * Re-snoozing must not forget that the thread came from the inbox.
   *
   * The first snooze strips INBOX. So the second `create` reads the labels as
   * they are NOW — already archived — and recording that would mean the thread
   * fires its notification and then stays out of the inbox for good. The user
   * pressed "remind me later" twice and the mail never came back.
   */
  it('remembers the thread was in the inbox when it is snoozed a second time', async () => {
    const user = await createUser();
    await createEmail(user.id, { threadId: 'thread-again', labelIds: ['INBOX'] });

    await snoozeService.create(user.id, {
      threadId: 'thread-again',
      kind: 'snooze',
      remindAt: inAnHour(),
    });
    // Precondition: the first snooze really did take INBOX away, which is what
    // makes the naive recompute return false.
    const afterFirst = await prisma.email.findFirstOrThrow({
      where: { userId: user.id, threadId: 'thread-again' },
    });
    expect(afterFirst.labelIds).not.toContain('INBOX');

    await snoozeService.create(user.id, {
      threadId: 'thread-again',
      kind: 'snooze',
      remindAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    const armed = await prisma.emailReminder.findFirstOrThrow({
      where: { userId: user.id, state: 'armed' },
    });
    expect(armed.wasInInbox).toBe(true);
  });

  /** The other direction still has to work: archived stays archived. */
  it('does not invent an inbox for a thread that was archived both times', async () => {
    const user = await createUser();
    await createEmail(user.id, { threadId: 'thread-arch-twice', labelIds: [], isArchived: true });

    await snoozeService.create(user.id, {
      threadId: 'thread-arch-twice',
      kind: 'snooze',
      remindAt: inAnHour(),
    });
    await snoozeService.create(user.id, {
      threadId: 'thread-arch-twice',
      kind: 'snooze',
      remindAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    const armed = await prisma.emailReminder.findFirstOrThrow({
      where: { userId: user.id, state: 'armed' },
    });
    expect(armed.wasInInbox).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Waking up
// ─────────────────────────────────────────────────────────────────────────────

describe('firing a snooze', () => {
  it('puts the thread back in the inbox, unread, and marks the reminder fired', async () => {
    const user = await createUser();
    const email = await createEmail(user.id, {
      gmailMessageId: 'msg-wake',
      threadId: 'thread-wake',
      labelIds: ['INBOX'],
      isRead: true,
    });
    await snoozeService.create(user.id, {
      threadId: 'thread-wake',
      kind: 'snooze',
      remindAt: inAnHour(),
    });
    // Pull the deadline into the past now that the snooze is armed.
    await prisma.emailReminder.updateMany({
      where: { userId: user.id },
      data: { remindAt: anHourAgo() },
    });

    expect(await snoozeService.processDue()).toBe(1);

    const woken = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(woken.labelIds).toContain('INBOX');
    expect(woken.isArchived).toBe(false);
    expect(woken.isRead).toBe(false);
    expect(await visibleThreadIds(user.id, 'inbox')).toEqual(['thread-wake']);

    const reminder = await prisma.emailReminder.findFirstOrThrow({ where: { userId: user.id } });
    expect(reminder.state).toBe('fired');
    expect(reminder.resolution).toBe('due');

    // And the user is told, since the thread reappears at its real date rather
    // than being faked to the top of the list.
    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('EMAIL_SNOOZE_RETURNED');

    // Gmail was told the same thing.
    expect(gmail.messagesModify).toHaveBeenCalled();
    const lastCall = gmail.messagesModify.mock.calls.length - 1;
    expect(modifyParams(gmail.messagesModify, lastCall).requestBody?.addLabelIds)
      .toEqual(expect.arrayContaining(['INBOX', 'UNREAD']));
  });

  /**
   * — REGRESSION —
   *
   * "Unsnooze" cannot mean "restore unconditionally". The user snoozed the
   * thread, then changed their mind and binned it. Firing must notice and let
   * it lie: pulling a deleted thread back into the inbox an hour later, unread,
   * is a bug the user cannot explain and cannot prevent except by never using
   * snooze.
   */
  it('— REGRESSION: does not revive a thread the user has since trashed', async () => {
    const user = await createUser();
    const email = await createEmail(user.id, {
      gmailMessageId: 'msg-binned',
      threadId: 'thread-gone',
      labelIds: ['INBOX'],
      isRead: true,
    });
    await snoozeService.create(user.id, {
      threadId: 'thread-gone',
      kind: 'snooze',
      remindAt: inAnHour(),
    });
    await emailService.trash(email.id, user.id);
    await prisma.emailReminder.updateMany({
      where: { userId: user.id },
      data: { remindAt: anHourAgo() },
    });
    gmail.messagesModify.mockClear();

    expect(await snoozeService.processDue()).toBe(0);

    const stillBinned = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(stillBinned.isTrashed).toBe(true);
    expect(stillBinned.labelIds).not.toContain('INBOX');
    expect(stillBinned.isRead).toBe(true);
    expect(gmail.messagesModify).not.toHaveBeenCalled();
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);

    const reminder = await prisma.emailReminder.findFirstOrThrow({ where: { userId: user.id } });
    expect(reminder.state).toBe('cancelled');
    expect(reminder.resolution).toBe('trashed');
  });

  it('drops the reminder when the thread no longer exists at all', async () => {
    const user = await createUser();
    await armOverdue(user.id, 'thread-vanished', 'snooze');

    expect(await snoozeService.processDue()).toBe(0);
    const reminder = await prisma.emailReminder.findFirstOrThrow({ where: { userId: user.id } });
    expect(reminder.resolution).toBe('gone');
  });

  /**
   * Snoozing something that was already out of the inbox — an archived thread
   * you want to look at again on Monday — must not put it back in the inbox on
   * the way out. `wasInInbox` is recorded at arming time for exactly this.
   */
  it('does not add INBOX to a thread that was not in the inbox when snoozed', async () => {
    const user = await createUser();
    const email = await createEmail(user.id, {
      gmailMessageId: 'msg-archived',
      threadId: 'thread-archived',
      labelIds: [],
      isArchived: true,
      isRead: true,
    });
    await snoozeService.create(user.id, {
      threadId: 'thread-archived',
      kind: 'snooze',
      remindAt: inAnHour(),
    });
    await prisma.emailReminder.updateMany({
      where: { userId: user.id },
      data: { remindAt: anHourAgo() },
    });

    await snoozeService.processDue();

    const woken = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(woken.labelIds).not.toContain('INBOX');
    expect(woken.isArchived).toBe(true);
    // It still comes back unread — that is what makes it noticeable.
    expect(woken.isRead).toBe(false);
  });

  it('cancelling a snooze by hand brings the thread straight back', async () => {
    const user = await createUser();
    const email = await createEmail(user.id, {
      gmailMessageId: 'msg-manual',
      threadId: 'thread-manual',
      labelIds: ['INBOX'],
      isRead: true,
    });
    const reminder = await snoozeService.create(user.id, {
      threadId: 'thread-manual',
      kind: 'snooze',
      remindAt: inAnHour(),
    });

    await snoozeService.cancel(user.id, reminder.id);

    const back = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(back.labelIds).toContain('INBOX');
    expect(back.isArchived).toBe(false);
    expect(await visibleThreadIds(user.id)).toEqual(['thread-manual']);
    expect((await prisma.emailReminder.findUniqueOrThrow({ where: { id: reminder.id } })).resolution)
      .toBe('manual');
  });

  /**
   * Coming back from downtime with a pile of overdue snoozes must not fire them
   * all in one breath: each one is a Gmail write per message against the
   * per-user rate limiter, plus a notification. The backlog drains over
   * successive ticks instead — nothing is lost, it just arrives oldest first.
   */
  it('fires at most MAX_REMINDERS_PER_TICK in one pass, oldest first', async () => {
    const user = await createUser();
    const overdue = MAX_REMINDERS_PER_TICK + 5;
    for (let i = 0; i < overdue; i++) {
      await createEmail(user.id, { threadId: `thread-backlog-${i}`, labelIds: ['INBOX'] });
      await armOverdue(user.id, `thread-backlog-${i}`, 'snooze', {
        remindAt: new Date(Date.now() - (overdue - i) * 60_000),
      });
    }

    expect(await snoozeService.processDue()).toBe(MAX_REMINDERS_PER_TICK);
    expect(await prisma.emailReminder.count({ where: { state: 'armed' } })).toBe(5);
    // The five left behind are the five newest deadlines.
    const left = await prisma.emailReminder.findMany({
      where: { state: 'armed' },
      orderBy: { remindAt: 'asc' },
    });
    expect(left.map((r) => r.threadId)).toEqual([
      'thread-backlog-25',
      'thread-backlog-26',
      'thread-backlog-27',
      'thread-backlog-28',
      'thread-backlog-29',
    ]);

    expect(await snoozeService.processDue()).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Follow-ups and the reply that cancels them
// ─────────────────────────────────────────────────────────────────────────────

describe('follow-up reminders', () => {
  /**
   * — REGRESSION —
   *
   * The one behaviour that distinguishes a follow-up from a snooze. The sync is
   * the only thing that ever learns a reply arrived, and all it does is write
   * another `emails` row carrying the same `threadId` — so that row, and
   * nothing else, is the cancellation signal.
   */
  it('— REGRESSION: an incoming reply cancels the follow-up', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'me@corp.example' });
    await createEmail(user.id, {
      threadId: 'thread-awaiting',
      from: 'me@corp.example',
      receivedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });

    await snoozeService.create(user.id, {
      threadId: 'thread-awaiting',
      kind: 'follow_up',
      remindAt: inAnHour(),
    });

    // Nothing has come back yet.
    expect(await snoozeService.cancelRepliedFollowUps()).toBe(0);

    // …and now it has, exactly as the sync would land it.
    await createEmail(user.id, {
      threadId: 'thread-awaiting',
      from: 'them@customer.example',
      receivedAt: new Date(),
    });

    expect(await snoozeService.cancelRepliedFollowUps()).toBe(1);
    const reminder = await prisma.emailReminder.findFirstOrThrow({ where: { userId: user.id } });
    expect(reminder.state).toBe('cancelled');
    expect(reminder.resolution).toBe('replied');
    // Cancelled silently: the point is that the user is not pestered.
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
  });

  it('does not count the user’s own later message as a reply', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'me@corp.example' });
    await createEmail(user.id, {
      threadId: 'thread-nudge',
      from: 'them@customer.example',
      receivedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });
    await snoozeService.create(user.id, {
      threadId: 'thread-nudge',
      kind: 'follow_up',
      remindAt: inAnHour(),
    });

    // The user chases them again. Still nobody has answered.
    await createEmail(user.id, {
      threadId: 'thread-nudge',
      from: 'ME@Corp.Example',
      receivedAt: new Date(),
    });

    expect(await snoozeService.cancelRepliedFollowUps()).toBe(0);
    expect((await prisma.emailReminder.findFirstOrThrow({ where: { userId: user.id } })).state)
      .toBe('armed');
  });

  it('fires when the deadline passes with no reply, without touching labels', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'me@corp.example' });
    const email = await createEmail(user.id, {
      gmailMessageId: 'msg-unanswered',
      threadId: 'thread-unanswered',
      from: 'me@corp.example',
      labelIds: ['INBOX'],
      isRead: true,
    });
    await armOverdue(user.id, 'thread-unanswered', 'follow_up', { armedAt: anHourAgo() });

    expect(await snoozeService.processDue()).toBe(1);

    const untouched = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(untouched.labelIds).toEqual(['INBOX']);
    expect(untouched.isRead).toBe(true);
    expect(gmail.messagesModify).not.toHaveBeenCalled();

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('EMAIL_FOLLOW_UP_DUE');
  });

  /**
   * The scheduler clears replied follow-ups before it fires due ones, but a
   * reply can sync in between the two passes. `fire` re-checks rather than
   * trusting the row it was handed.
   */
  it('does not fire a due follow-up whose reply landed since the last sweep', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'me@corp.example' });
    const armedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await createEmail(user.id, {
      threadId: 'thread-late-reply',
      from: 'me@corp.example',
      receivedAt: armedAt,
    });
    const reminder = await armOverdue(user.id, 'thread-late-reply', 'follow_up', { armedAt });
    await createEmail(user.id, {
      threadId: 'thread-late-reply',
      from: 'them@customer.example',
      receivedAt: new Date(),
    });

    expect(await snoozeService.fire(reminder.id)).toBe(false);
    const after = await prisma.emailReminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(after.resolution).toBe('replied');
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
  });

  it('is idempotent — firing the same reminder twice notifies once', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'me@corp.example' });
    await createEmail(user.id, { threadId: 'thread-once', from: 'me@corp.example' });
    const reminder = await armOverdue(user.id, 'thread-once', 'follow_up');

    expect(await snoozeService.fire(reminder.id)).toBe(true);
    expect(await snoozeService.fire(reminder.id)).toBe(false);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
  });
});
