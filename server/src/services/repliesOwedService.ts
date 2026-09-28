import { prisma } from '../lib/prisma.js';
import { classifyContactKind } from '../utils/contactKind.js';
import { isSystemSenderName } from '../utils/automatedSender.js';
import { CATEGORY_LABELS } from '../utils/mailCategories.js';

/** How far back an unanswered message still counts as owed. */
export const REPLY_WINDOW_DAYS = 14;

export interface ReplyOwed {
  threadId: string;
  emailId: string;
  subject: string;
  from: string;
  fromName: string | null;
  /** When the message waiting on the user arrived. */
  receivedAt: Date;
}

const CATEGORY_LABEL_SET = new Set(Object.values(CATEGORY_LABELS));

/** The bare address out of `Name <address>`. */
export function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}

/**
 * Calendar mail: an invitation or an RSVP is answered from the calendar, not
 * by writing back. Gmail's English and French subject prefixes, colon and all
 * — "Invitation à l'événement …" without one is a marketing mail, not this.
 */
const CALENDAR_SUBJECT = /^((updated )?invitation( with note)?|invitation mise à jour|accepted|declined|tentatively accepted|accepté|refusé|acceptée provisoirement|canceled event|cancelled event|événement annulé|new event|nouvel événement)( \([^)]*\))?:/i;

/** Out-of-office replies, which want nothing back. */
const AUTO_REPLY_SUBJECT = /^(automatic reply|auto(-| )?reply|out of (the )?office|réponse automatique|absence|absent)\b/i;


/**
 * Threads where a person is waiting on the user.
 *
 * The latest message in the thread came from someone else — a person, not a
 * list, not an automated sender, not a shared mailbox (a support@ desk has
 * its own ticketing tool: 1,147 "New ticket has been created" mails came
 * from one), not a Promotions/Updates/Social/Forums mail, not a calendar
 * invitation or an out-of-office reply — it was
 * addressed to the user directly, it is still in the inbox, and it arrived in
 * the last two weeks. That is what "7 people are waiting on you" means; the
 * mail badge used to count 11,000 unread messages instead, which is a
 * number nobody can act on.
 */
/** Who the user is: the login address, and whatever they have sent from. */
export async function ownAddresses(userId: string): Promise<Set<string>> {
  const [user, sentFrom] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.email.findMany({
      where: { userId, labelIds: { has: 'SENT' } },
      distinct: ['from'],
      select: { from: true },
      take: 20,
    }),
  ]);
  return new Set([user?.email?.toLowerCase(), ...sentFrom.map((e) => addressOf(e.from))].filter(Boolean) as string[]);
}

/** Not calendar mail, not an out-of-office reply — a message that wants an answer. */
export function isConversationSubject(subject: string): boolean {
  const s = subject.trim();
  return !CALENDAR_SUBJECT.test(s) && !AUTO_REPLY_SUBJECT.test(s);
}

export async function repliesOwed(userId: string, now = new Date()): Promise<ReplyOwed[]> {
  const since = new Date(now.getTime() - REPLY_WINDOW_DAYS * 86_400_000);
  const own = await ownAddresses(userId);

  // The latest message of each thread active in the window.
  const latest = await prisma.$queryRaw<
    Array<{ id: string; thread_id: string; subject: string; from: string; from_name: string | null; received_at: Date; to: string[]; label_ids: string[]; is_archived: boolean; is_trashed: boolean }>
  >`
    SELECT DISTINCT ON (thread_id) id, thread_id, subject, "from", from_name, received_at, "to", label_ids, is_archived, is_trashed
    FROM emails
    WHERE user_id = ${userId} AND thread_id IS NOT NULL AND received_at >= ${since}
    ORDER BY thread_id, received_at DESC
  `;

  return latest
    // A raw query hands back NULL, not [], for an empty array column.
    .map((m) => ({ ...m, label_ids: m.label_ids ?? [], to: m.to ?? [] }))
    .filter((m) => {
      if (m.is_archived || m.is_trashed) return false;
      if (m.label_ids.includes('SENT') || !m.label_ids.includes('INBOX')) return false;
      if (m.label_ids.some((l) => CATEGORY_LABEL_SET.has(l))) return false;
      const sender = addressOf(m.from);
      if (own.has(sender)) return false;
      if (classifyContactKind({ email: sender }) !== 'person') return false;
      if (isSystemSenderName(m.from_name)) return false;
      if (!isConversationSubject(m.subject)) return false;
      // Directly to the user — not a CC, not a list they are on.
      return m.to.some((t) => own.has(addressOf(t)));
    })
    .map((m) => ({
      threadId: m.thread_id,
      emailId: m.id,
      subject: m.subject,
      from: m.from,
      fromName: m.from_name,
      receivedAt: m.received_at,
    }))
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}
