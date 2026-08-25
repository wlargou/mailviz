import type { Email } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { getGmailClient } from '../lib/gmail.js';
import { AppError } from '../middleware/errorHandler.js';
import { auditService } from './auditService.js';
import { notificationService } from './notificationService.js';
import { wsEmitToUser } from '../websocket.js';

/**
 * Snooze and follow-up reminders.
 *
 * ── One table, two behaviours ────────────────────────────────────────────────
 *
 * Both features are "do something to this thread at time T", both need the same
 * scheduler and the same per-thread bookkeeping, so they share `EmailReminder`.
 * They differ entirely in what firing means:
 *
 *   snooze     hides the thread from every mail folder until `remindAt`, then
 *              puts it back — in the inbox if that is where it came from, and
 *              unread so it reads as new.
 *   follow_up  hides nothing. It fires a reminder at `remindAt` *unless*
 *              somebody replied first, in which case it is cancelled silently.
 *              That cancellation is the entire point of the feature, and it is
 *              why it cannot just be a snooze with a different label.
 *
 * ── How a snooze survives the 60-second Gmail sync ───────────────────────────
 *
 * `emailService.upsertMessage` rewrites every column of an `emails` row from
 * whatever Gmail last said, and the incremental `labelsAdded`/`labelsRemoved`
 * handlers rewrite `labelIds` plus the four booleans `flagsFromLabels` derives
 * from it. Anything about snoozing kept on `emails` is therefore state the sync
 * is obliged to destroy within a minute.
 *
 * So the authority is the `email_reminders` row, keyed by `(userId, threadId)`
 * — a Gmail *thread* identity, which no sync path writes to and which survives
 * an individual message being deleted and re-imported. `findAllThreads` asks
 * this table which threads to leave out. The hiding cannot be undone by a sync
 * because the sync has no reason to touch the table that does the hiding.
 *
 * The Gmail label move (dropping INBOX so the user's own Gmail inbox agrees)
 * is deliberately *not* the mechanism — it is a best-effort mirror on top, in
 * the same shape as every other Gmail write here: local row first, Gmail call
 * in a try/catch. If Gmail refuses, the thread is still hidden in this app.
 */

export const REMINDER_KINDS = ['snooze', 'follow_up'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/**
 * How many due reminders one scheduler tick acts on.
 *
 * Firing a snooze costs a Gmail write per message in the thread. Coming back
 * from a weekend of downtime with several hundred overdue snoozes and firing
 * them all at once would hand the per-user Bottleneck in `lib/gmailLimiter.ts`
 * a burst it can only absorb by queueing for minutes — and would bury the user
 * under a wall of notifications in the same second. A bounded batch drains the
 * backlog steadily instead: nothing is dropped, it just arrives in order,
 * oldest first.
 */
export const MAX_REMINDERS_PER_TICK = 25;

/** How many armed follow-ups one tick re-checks for an incoming reply. */
export const MAX_FOLLOW_UP_CHECKS_PER_TICK = 200;

interface CreateReminderInput {
  threadId: string;
  kind: ReminderKind;
  remindAt: Date;
}

/**
 * Must agree with `flagsFromLabels` in emailService — same rule, and the same
 * reason for existing: the flag is derived from the RESULTING label set, never
 * from the delta. Duplicated rather than imported to keep this module free of
 * an import cycle with emailService, which imports `snoozedThreadIds` from here.
 */
function archivedFromLabels(labelIds: string[]): boolean {
  return !labelIds.includes('INBOX') && !labelIds.includes('TRASH');
}

/** The addresses that count as "me", so a message from them is not a reply. */
async function selfAddresses(userId: string): Promise<Set<string>> {
  const [auth, user] = await Promise.all([
    prisma.googleAuth.findFirst({ where: { userId }, select: { email: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
  ]);
  return new Set(
    [auth?.email, user?.email]
      .filter((e): e is string => !!e)
      .map((e) => e.toLowerCase())
  );
}

/**
 * Did somebody other than the user add a message to this thread since the
 * reminder was armed?
 *
 * The sync is the only thing that learns a reply arrived, and all it does is
 * write another `emails` row carrying the same `threadId`. So the question is
 * answerable entirely from the local table: any message in the thread newer
 * than `armedAt` that is not from one of the user's own addresses and is not a
 * draft. `armedAt` is the newest message at arming time rather than the wall
 * clock, so a reply that had already landed but had not synced yet still counts.
 */
async function threadHasReply(userId: string, threadId: string, armedAt: Date): Promise<boolean> {
  const [later, mine] = await Promise.all([
    prisma.email.findMany({
      where: { userId, threadId, receivedAt: { gt: armedAt } },
      select: { from: true, labelIds: true },
    }),
    selfAddresses(userId),
  ]);
  return later.some(
    (m) => !mine.has(m.from.toLowerCase()) && !m.labelIds.includes('DRAFT')
  );
}

/** Every message the caller owns in this thread, oldest first. */
async function ownedThread(userId: string, threadId: string): Promise<Email[]> {
  return prisma.email.findMany({
    where: { userId, threadId },
    orderBy: { receivedAt: 'asc' },
  });
}

/**
 * Take the thread out of the Gmail inbox.
 *
 * Best effort in both directions, per the repo convention: the local rows are
 * updated first and each Gmail call is individually wrapped, so a revoked grant
 * or a rate limit costs the Gmail mirror, never the snooze.
 */
async function removeFromInbox(userId: string, emails: Email[]): Promise<void> {
  const targets = emails.filter((e) => !e.isTrashed && e.labelIds.includes('INBOX'));
  if (targets.length === 0) return;

  for (const email of targets) {
    const labelIds = email.labelIds.filter((l) => l !== 'INBOX');
    await prisma.email.update({
      where: { id: email.id },
      data: { labelIds, isArchived: archivedFromLabels(labelIds) },
    });
  }

  try {
    const gmail = await getGmailClient(userId);
    for (const email of targets) {
      if (!email.gmailMessageId) continue;
      try {
        await gmail.users.messages.modify({
          userId: 'me',
          id: email.gmailMessageId,
          requestBody: { removeLabelIds: ['INBOX'] },
        });
      } catch (err: unknown) {
        console.warn('[Snooze] Gmail API call failed:', err instanceof Error ? err.message : err);
      }
    }
  } catch (err: unknown) {
    console.warn('[Snooze] Gmail API call failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Put a snoozed thread back: into the inbox if that is where it was, and with
 * its newest message unread so it reads as something that just arrived.
 *
 * Note what this deliberately does NOT do: it does not rewrite `receivedAt`.
 * The thread reappears at its real date rather than being faked to the top of
 * the list — the notification raised alongside it is what tells the user it is
 * back. Lying about when mail arrived would corrupt every date filter, the
 * review flow's period buckets and the dashboard.
 */
async function restoreThread(userId: string, emails: Email[], wasInInbox: boolean): Promise<void> {
  const live = emails.filter((e) => !e.isTrashed);
  if (live.length === 0) return;
  const newest = live[live.length - 1];

  for (const email of live) {
    const addInbox = wasInInbox && !email.labelIds.includes('INBOX');
    const addUnread = email.id === newest.id && !email.labelIds.includes('UNREAD');
    if (!addInbox && !addUnread) continue;

    const labelIds = [
      ...email.labelIds,
      ...(addInbox ? ['INBOX'] : []),
      ...(addUnread ? ['UNREAD'] : []),
    ];
    await prisma.email.update({
      where: { id: email.id },
      data: {
        labelIds,
        isArchived: archivedFromLabels(labelIds),
        ...(addUnread ? { isRead: false } : {}),
      },
    });
  }

  try {
    const gmail = await getGmailClient(userId);
    for (const email of live) {
      const addLabelIds = [
        ...(wasInInbox && !email.labelIds.includes('INBOX') ? ['INBOX'] : []),
        ...(email.id === newest.id && !email.labelIds.includes('UNREAD') ? ['UNREAD'] : []),
      ];
      if (addLabelIds.length === 0 || !email.gmailMessageId) continue;
      try {
        await gmail.users.messages.modify({
          userId: 'me',
          id: email.gmailMessageId,
          requestBody: { addLabelIds },
        });
      } catch (err: unknown) {
        console.warn('[Snooze] Gmail API call failed:', err instanceof Error ? err.message : err);
      }
    }
  } catch (err: unknown) {
    console.warn('[Snooze] Gmail API call failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Move an armed reminder to a terminal state.
 *
 * The `state: 'armed'` guard makes this idempotent: two overlapping scheduler
 * ticks, or a tick racing the user's own "unsnooze now", cannot both resolve
 * the same row. Whoever gets there second updates nothing and is told so.
 */
async function resolve(
  id: string,
  state: 'fired' | 'cancelled',
  resolution: string
): Promise<boolean> {
  const result = await prisma.emailReminder.updateMany({
    where: { id, state: 'armed' },
    data: { state, resolution, firedAt: new Date() },
  });
  return result.count > 0;
}

export const snoozeService = {
  /**
   * The threads to leave out of the mail list right now.
   *
   * Read by `emailService.findAllThreads` on every query. Only snoozes hide
   * anything — a follow-up leaves the thread exactly where it was.
   */
  async snoozedThreadIds(userId: string): Promise<string[]> {
    const rows = await prisma.emailReminder.findMany({
      where: { userId, kind: 'snooze', state: 'armed' },
      select: { threadId: true },
    });
    return rows.map((r) => r.threadId);
  },

  /** Every reminder the user still has pending, soonest first. */
  async listArmed(userId: string) {
    return prisma.emailReminder.findMany({
      where: { userId, state: 'armed' },
      orderBy: { remindAt: 'asc' },
    });
  },

  /**
   * Arm a snooze or a follow-up on a thread.
   *
   * Ownership is checked by looking for the caller's OWN messages in the
   * thread, not via `canAccessThread`: a thread shared with you renders from
   * its owner's rows, so letting a recipient snooze it would either do nothing
   * or move labels in somebody else's mailbox.
   */
  async create(userId: string, input: CreateReminderInput) {
    if (input.remindAt.getTime() <= Date.now()) {
      throw new AppError(400, 'REMIND_AT_IN_PAST', 'Pick a time in the future');
    }

    const emails = await ownedThread(userId, input.threadId);
    if (emails.length === 0) {
      throw new AppError(404, 'THREAD_NOT_FOUND', 'Thread not found');
    }

    const wasInInbox = emails.some((e) => e.labelIds.includes('INBOX'));
    // The newest message we currently know about is the reply threshold — see
    // threadHasReply.
    const armedAt = emails.reduce(
      (latest, e) => (e.receivedAt > latest ? e.receivedAt : latest),
      emails[0].receivedAt
    );

    // Re-snoozing replaces rather than stacks. Without this a thread could
    // carry several armed snoozes and fire several times.
    await prisma.emailReminder.updateMany({
      where: { userId, threadId: input.threadId, kind: input.kind, state: 'armed' },
      data: { state: 'cancelled', resolution: 'replaced' },
    });

    const reminder = await prisma.emailReminder.create({
      data: {
        userId,
        threadId: input.threadId,
        kind: input.kind,
        remindAt: input.remindAt,
        armedAt,
        wasInInbox,
      },
    });

    if (input.kind === 'snooze') {
      await removeFromInbox(userId, emails);
    }

    const subject = emails[emails.length - 1].subject;
    auditService.log({
      userId,
      action: input.kind === 'snooze' ? 'EMAIL_SNOOZED' : 'EMAIL_FOLLOW_UP_SET',
      entityType: 'email',
      entityId: input.threadId,
      details: { subject, remindAt: input.remindAt.toISOString() },
    });
    wsEmitToUser(userId, 'reminder:changed', { threadId: input.threadId, kind: input.kind });

    return reminder;
  },

  /**
   * Drop a pending reminder.
   *
   * For a snooze that means "bring it back now" — the thread returns to the
   * inbox exactly as if its time had come, because leaving it hidden with
   * nothing scheduled to reveal it would lose it entirely.
   */
  async cancel(userId: string, id: string) {
    const reminder = await prisma.emailReminder.findFirst({
      where: { id, userId, state: 'armed' },
    });
    if (!reminder) throw new AppError(404, 'REMINDER_NOT_FOUND', 'Reminder not found');

    if (reminder.kind === 'snooze') {
      const emails = await ownedThread(userId, reminder.threadId);
      await restoreThread(userId, emails, reminder.wasInInbox);
    }

    await resolve(reminder.id, 'cancelled', 'manual');

    auditService.log({
      userId,
      action: reminder.kind === 'snooze' ? 'EMAIL_UNSNOOZED' : 'EMAIL_FOLLOW_UP_CLEARED',
      entityType: 'email',
      entityId: reminder.threadId,
      details: { reason: 'manual' },
    });
    wsEmitToUser(userId, 'reminder:changed', { threadId: reminder.threadId, kind: reminder.kind });

    return { success: true };
  },

  /**
   * Clear follow-ups whose reply has arrived.
   *
   * Run on every tick rather than only when a follow-up comes due, so the
   * pending list stops showing a reminder the moment the answer lands instead
   * of at the deadline.
   */
  async cancelRepliedFollowUps(): Promise<number> {
    const armed = await prisma.emailReminder.findMany({
      where: { state: 'armed', kind: 'follow_up' },
      orderBy: { remindAt: 'asc' },
      take: MAX_FOLLOW_UP_CHECKS_PER_TICK,
    });

    let cancelled = 0;
    for (const reminder of armed) {
      if (!(await threadHasReply(reminder.userId, reminder.threadId, reminder.armedAt))) continue;
      if (!(await resolve(reminder.id, 'cancelled', 'replied'))) continue;
      cancelled++;
      auditService.log({
        userId: reminder.userId,
        action: 'EMAIL_FOLLOW_UP_CLEARED',
        entityType: 'email',
        entityId: reminder.threadId,
        details: { reason: 'replied' },
      });
      wsEmitToUser(reminder.userId, 'reminder:changed', {
        threadId: reminder.threadId,
        kind: reminder.kind,
      });
    }
    return cancelled;
  },

  /**
   * Fire everything that has come due, oldest first, up to
   * `MAX_REMINDERS_PER_TICK`.
   */
  async processDue(now: Date = new Date()): Promise<number> {
    const due = await prisma.emailReminder.findMany({
      where: { state: 'armed', remindAt: { lte: now } },
      orderBy: { remindAt: 'asc' },
      take: MAX_REMINDERS_PER_TICK,
    });

    let fired = 0;
    for (const reminder of due) {
      try {
        if (await this.fire(reminder.id)) fired++;
      } catch (err: unknown) {
        console.error(
          `[Snooze] Failed to fire reminder ${reminder.id}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    return fired;
  },

  /**
   * Act on one due reminder.
   *
   * Everything is re-read here rather than trusted from the row that was
   * queued, because the state that matters is the state *now*: reviving a
   * thread the user has since dealt with is a bug, not a feature. Three ways a
   * reminder resolves without firing:
   *
   *   gone     the thread no longer exists locally (Gmail deleted every
   *            message; the sync removed the rows).
   *   trashed  every message in it is in the trash. The user threw it away
   *            while it was snoozed; do not fish it back out.
   *   replied  a follow-up whose answer arrived — the whole feature.
   *
   * Returns true only when the reminder actually fired.
   */
  async fire(id: string): Promise<boolean> {
    const reminder = await prisma.emailReminder.findFirst({ where: { id, state: 'armed' } });
    if (!reminder) return false;

    const { userId, threadId, kind } = reminder;
    const emails = await ownedThread(userId, threadId);

    if (emails.length === 0) {
      await resolve(id, 'cancelled', 'gone');
      return false;
    }
    if (emails.every((e) => e.isTrashed)) {
      await resolve(id, 'cancelled', 'trashed');
      return false;
    }
    if (kind === 'follow_up' && (await threadHasReply(userId, threadId, reminder.armedAt))) {
      // Belt and braces: cancelRepliedFollowUps normally gets here first, but a
      // reply that synced in between that pass and this one must still count.
      await resolve(id, 'cancelled', 'replied');
      auditService.log({
        userId,
        action: 'EMAIL_FOLLOW_UP_CLEARED',
        entityType: 'email',
        entityId: threadId,
        details: { reason: 'replied' },
      });
      wsEmitToUser(userId, 'reminder:changed', { threadId, kind });
      return false;
    }

    if (kind === 'snooze') {
      await restoreThread(userId, emails, reminder.wasInInbox);
    }

    // Claim the row BEFORE notifying: a notification is user-visible and must
    // not be sent twice if the process dies mid-fire.
    if (!(await resolve(id, 'fired', 'due'))) return false;

    const subject = emails[emails.length - 1].subject;
    await notificationService.create(userId, {
      type: kind === 'snooze' ? 'EMAIL_SNOOZE_RETURNED' : 'EMAIL_FOLLOW_UP_DUE',
      title:
        kind === 'snooze'
          ? `Back in your inbox: ${subject}`
          : `Still no reply: ${subject}`,
      message:
        kind === 'snooze'
          ? 'A thread you snoozed is back.'
          : 'Nobody has replied since you asked to be reminded.',
      entityType: 'email',
      entityId: threadId,
    });

    auditService.log({
      userId,
      action: kind === 'snooze' ? 'EMAIL_UNSNOOZED' : 'EMAIL_FOLLOW_UP_CLEARED',
      entityType: 'email',
      entityId: threadId,
      details: { reason: 'due', subject },
    });
    wsEmitToUser(userId, 'reminder:fired', { threadId, kind });

    return true;
  },
};
