import { prisma } from '../lib/prisma.js';
import { taskService } from './taskService.js';
import { deadlineService, type Deadline } from './deadlineService.js';
import { repliesOwed, addressOf, ownAddresses, isConversationSubject, REPLY_WINDOW_DAYS } from './repliesOwedService.js';
import { readinessOf } from './rfpService.js';
import { isAtRisk } from '../utils/rfpRisk.js';
import { RFP_TERMINAL_STATUSES } from '../utils/rfp.js';
import { classifyContactKind } from '../utils/contactKind.js';
import { getSharedDealIds, getSharedRfpIds, getSharedTaskIds } from '../utils/accessControl.js';
import { terminalStatusNames, notTerminal } from '../utils/taskStatus.js';
import { resolveTimeZone, startOfDayInZone, addDaysInZone } from '../utils/timezone.js';

/**
 * Today: one answer to "what needs me now", replacing a Dashboard that
 * summarised activity and a My Day that only knew about tasks.
 *
 * Everything dated lands here — meetings, tender and piece deadlines, due
 * tasks, replies owed — alongside the stakes that span days: pursuits
 * closing, mail waiting on someone else, accounts going quiet. The next
 * meeting comes with its context (the last threads with those people, their
 * company's open work), and after the working day a wrap-up says what closed,
 * what slipped and what comes first tomorrow.
 *
 * The server hands back the parts; the page decides the order. Each part is
 * computed from data the app already has — nothing here is stored.
 */

/** How far ahead a pursuit counts as closing. */
export const CLOSING_WINDOW_DAYS = 14;
/** How long a sent message may wait before it counts as waiting on others. */
export const WAITING_AFTER_HOURS = 48;
/** How long without an exchange before an account with open work is quiet. */
export const QUIET_AFTER_DAYS = 21;

const DAY = 86_400_000;

export interface TodayEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  location: string | null;
  conferenceLink: string | null;
  companies: Array<{ id: string; name: string }>;
  attendeeCount: number;
}

export interface Pursuit {
  kind: 'RFP' | 'DEAL';
  id: string;
  title: string;
  reference: string | null;
  company: string | null;
  customerId: string | null;
  /** The tender's deadline, or the deal registration's expiry. */
  at: Date;
  readiness: { ready: number; total: number } | null;
  atRisk: boolean;
  href: string;
}

export interface WaitingOn {
  threadId: string;
  subject: string;
  /** Who it went to — the first person among the recipients. */
  to: string;
  sentAt: Date;
}

export interface QuietAccount {
  id: string;
  name: string;
  lastTouchAt: Date | null;
  openWork: number;
}

const EVENT_SELECT = {
  id: true,
  title: true,
  startTime: true,
  endTime: true,
  isAllDay: true,
  location: true,
  conferenceLink: true,
  attendees: true,
  customers: { select: { customer: { select: { id: true, name: true } } } },
} as const;

type EventRow = {
  id: string; title: string; startTime: Date; endTime: Date; isAllDay: boolean;
  location: string | null; conferenceLink: string | null; attendees: unknown;
  customers: Array<{ customer: { id: string; name: string } }>;
};

interface Attendee { email: string; name: string | null; self: boolean; responseStatus: string | null }

function attendeesOf(raw: unknown): Attendee[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((a) => {
    if (!a || typeof a !== 'object' || typeof (a as { email?: unknown }).email !== 'string') return [];
    const x = a as { email: string; displayName?: string | null; self?: boolean; responseStatus?: string | null };
    return [{ email: x.email.toLowerCase(), name: x.displayName ?? null, self: Boolean(x.self), responseStatus: x.responseStatus ?? null }];
  });
}

function toTodayEvent(e: EventRow): TodayEvent {
  return {
    id: e.id,
    title: e.title,
    startTime: e.startTime,
    endTime: e.endTime,
    isAllDay: e.isAllDay,
    location: e.location,
    conferenceLink: e.conferenceLink,
    companies: e.customers.map((c) => c.customer),
    attendeeCount: attendeesOf(e.attendees).length,
  };
}

/** Tenders the caller can open, and deal registrations, closing within the window. */
export async function pursuitsClosing(userId: string, now: Date): Promise<Pursuit[]> {
  const horizon = new Date(now.getTime() + CLOSING_WINDOW_DAYS * DAY);
  const [sharedRfpIds, sharedDealIds] = await Promise.all([getSharedRfpIds(userId), getSharedDealIds(userId)]);

  const [rfps, deals] = await Promise.all([
    prisma.rfp.findMany({
      where: {
        AND: [
          { OR: [{ userId }, ...(sharedRfpIds.length ? [{ id: { in: sharedRfpIds } }] : [])] },
          // Being prepared: a submitted tender is out of your hands, and a
          // closed one is history. A late unsubmitted one is still closing.
          { status: { notIn: [...RFP_TERMINAL_STATUSES, 'SUBMITTED'] } },
          { deadlineAt: { lte: horizon } },
        ],
      },
      select: {
        id: true, name: true, reference: true, status: true, deadlineAt: true, createdAt: true, publishedAt: true,
        customerId: true, customer: { select: { name: true } },
      },
    }),
    prisma.deal.findMany({
      where: {
        AND: [
          { OR: [{ userId }, ...(sharedDealIds.length ? [{ id: { in: sharedDealIds } }] : [])] },
          { status: { not: 'DECLINED' } },
          // A lapsed registration is worth a line for a week — renew or let go.
          { expiryDate: { gte: new Date(now.getTime() - 7 * DAY), lte: horizon } },
        ],
      },
      select: { id: true, title: true, expiryDate: true, customerId: true, customer: { select: { name: true } }, partner: { select: { name: true } } },
    }),
  ]);

  const readiness = await readinessOf(rfps.map((r) => r.id));
  const pursuits: Pursuit[] = [
    ...rfps.map((r) => {
      const ready = readiness.get(r.id) ?? { ready: 0, total: 0 };
      return {
        kind: 'RFP' as const,
        id: r.id,
        title: r.name,
        reference: r.reference,
        company: r.customer?.name ?? null,
        customerId: r.customerId,
        at: r.deadlineAt,
        readiness: ready,
        atRisk: isAtRisk(r, ready, now.getTime()),
        href: `/rfps/${r.id}`,
      };
    }),
    ...deals.map((d) => ({
      kind: 'DEAL' as const,
      id: d.id,
      title: d.title,
      reference: d.partner?.name ?? null,
      company: d.customer?.name ?? null,
      customerId: d.customerId,
      at: d.expiryDate!,
      readiness: null,
      atRisk: false,
      href: '/pursuits?tab=deals',
    })),
  ];
  return pursuits.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Threads the user wrote last, to a person, more than two days ago, and that
 * nobody has answered — the other side of "replies owed".
 */
export async function waitingOnOthers(userId: string, now: Date): Promise<WaitingOn[]> {
  const since = new Date(now.getTime() - REPLY_WINDOW_DAYS * DAY);
  const before = new Date(now.getTime() - WAITING_AFTER_HOURS * 3_600_000);
  const own = await ownAddresses(userId);

  const latest = await prisma.$queryRaw<
    Array<{ thread_id: string; subject: string; from: string; received_at: Date; to: string[] | null; label_ids: string[] | null; is_trashed: boolean }>
  >`
    SELECT DISTINCT ON (thread_id) thread_id, subject, "from", received_at, "to", label_ids, is_trashed
    FROM emails
    WHERE user_id = ${userId} AND thread_id IS NOT NULL AND received_at >= ${since}
    ORDER BY thread_id, received_at DESC
  `;

  return latest
    .flatMap((m) => {
      if (m.is_trashed || m.received_at > before) return [];
      if (!own.has(addressOf(m.from))) return [];
      if (!isConversationSubject(m.subject)) return [];
      const person = (m.to ?? []).find((t) => {
        const address = addressOf(t);
        return !own.has(address) && classifyContactKind({ email: address }) === 'person';
      });
      if (!person) return [];
      return [{ threadId: m.thread_id, subject: m.subject, to: person, sentAt: m.received_at }];
    })
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
}

/**
 * Accounts with open work — a task, a live tender, a live deal — and no mail
 * or meeting in three weeks. The relationship is the thing going quiet, and
 * nobody gets a notification for that.
 */
export async function quietAccounts(userId: string, now: Date): Promise<QuietAccount[]> {
  const terminal = await terminalStatusNames(userId);
  const cutoff = new Date(now.getTime() - QUIET_AFTER_DAYS * DAY);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; open_work: bigint; last_touch: Date | null }>>`
    WITH work AS (
      SELECT customer_id, COUNT(*) AS n FROM tasks
        WHERE user_id = ${userId} AND customer_id IS NOT NULL
          AND NOT (status = ANY(${terminal}::text[]))
        GROUP BY customer_id
      UNION ALL
      SELECT customer_id, COUNT(*) FROM rfps
        WHERE user_id = ${userId} AND customer_id IS NOT NULL
          AND status NOT IN ('WON', 'LOST', 'NO_BID', 'CANCELLED')
        GROUP BY customer_id
      UNION ALL
      SELECT customer_id, COUNT(*) FROM deals
        WHERE user_id = ${userId} AND customer_id IS NOT NULL AND status <> 'DECLINED'
        GROUP BY customer_id
    ),
    open_accounts AS (
      SELECT c.id, c.name, SUM(w.n) AS open_work
      FROM customers c JOIN work w ON w.customer_id = c.id
      WHERE c.user_id = ${userId} AND c.status = 'ACCOUNT' AND NOT c.is_internal
      GROUP BY c.id, c.name
    )
    SELECT o.id, o.name, o.open_work,
      GREATEST(
        (SELECT MAX(e.received_at) FROM emails e WHERE e.user_id = ${userId} AND e.customer_id = o.id AND e.received_at <= ${now}),
        (SELECT MAX(ev.start_time) FROM calendar_events ev
           JOIN calendar_event_customers cec ON cec.calendar_event_id = ev.id
           WHERE ev.user_id = ${userId} AND cec.customer_id = o.id AND ev.start_time <= ${now})
      ) AS last_touch
    FROM open_accounts o
  `;
  return rows
    .filter((r) => !r.last_touch || r.last_touch < cutoff)
    .map((r) => ({ id: r.id, name: r.name, lastTouchAt: r.last_touch, openWork: Number(r.open_work) }))
    .sort((a, b) => (a.lastTouchAt?.getTime() ?? 0) - (b.lastTouchAt?.getTime() ?? 0));
}

/**
 * What to know walking into a meeting: who is in it, the last threads with
 * them, and what is open with their companies.
 */
export async function meetingPrep(userId: string, event: EventRow) {
  const own = await ownAddresses(userId);
  const people = attendeesOf(event.attendees).filter((a) => !a.self && !own.has(a.email));
  const emails = people.map((p) => p.email);
  const customerIds = event.customers.map((c) => c.customer.id);

  const [recent, sharedTaskIds, sharedRfpIds, terminal] = await Promise.all([
    emails.length === 0
      ? Promise.resolve([] as Array<{ id: string; threadId: string | null; subject: string; from: string; fromName: string | null; receivedAt: Date }>)
      : prisma.email.findMany({
          where: { userId, isTrashed: false, OR: [{ from: { in: emails } }, { to: { hasSome: emails } }] },
          orderBy: { receivedAt: 'desc' },
          take: 30,
          select: { id: true, threadId: true, subject: true, from: true, fromName: true, receivedAt: true },
        }),
    getSharedTaskIds(userId),
    getSharedRfpIds(userId),
    terminalStatusNames(userId),
  ]);

  // Conversations with people: a ticketing desk that copies the attendees is
  // not what you want to reread before meeting them.
  const seen = new Set<string>();
  const recentThreads = recent.filter((m) => {
    if (!isConversationSubject(m.subject)) return false;
    const sender = addressOf(m.from);
    if (!own.has(sender) && classifyContactKind({ email: sender }) !== 'person') return false;
    const key = m.threadId ?? m.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);

  const [openTasks, rfps] = customerIds.length === 0
    ? [[], []]
    : await Promise.all([
        prisma.task.findMany({
          where: {
            AND: [
              { customerId: { in: customerIds } },
              { OR: [{ userId }, { assignedToId: userId }, ...(sharedTaskIds.length ? [{ id: { in: sharedTaskIds } }] : [])] },
              notTerminal(terminal),
            ],
          },
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
          take: 5,
          select: { id: true, title: true, dueDate: true, priority: true },
        }),
        prisma.rfp.findMany({
          where: {
            AND: [
              { customerId: { in: customerIds } },
              { OR: [{ userId }, ...(sharedRfpIds.length ? [{ id: { in: sharedRfpIds } }] : [])] },
              { status: { notIn: [...RFP_TERMINAL_STATUSES] } },
            ],
          },
          orderBy: { deadlineAt: 'asc' },
          select: { id: true, name: true, deadlineAt: true, status: true },
        }),
      ]);

  return {
    people: people.map((p) => ({ email: p.email, name: p.name, responseStatus: p.responseStatus })),
    recentThreads: recentThreads.map((m) => ({
      threadId: m.threadId, subject: m.subject, from: m.fromName || m.from, receivedAt: m.receivedAt,
    })),
    openTasks,
    tenders: rfps,
  };
}

export const todayService = {
  async forUser(userId: string, now = new Date()) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true, name: true } });
    const tz = resolveTimeZone(user?.timezone);
    const startOfToday = startOfDayInZone(now, tz);
    const startOfTomorrow = addDaysInZone(startOfToday, 1, tz);
    const endOfTomorrow = addDaysInZone(startOfToday, 2, tz);

    const [sharedTaskIds, terminal] = await Promise.all([getSharedTaskIds(userId), terminalStatusNames(userId)]);
    const reachableTask = { OR: [{ userId }, { assignedToId: userId }, ...(sharedTaskIds.length ? [{ id: { in: sharedTaskIds } }] : [])] };

    const [events, tomorrowEvents, myDay, deadlinesToday, deadlinesTomorrow, owed, pursuits, waiting, quiet, finishedToday, dueTomorrow] =
      await Promise.all([
        prisma.calendarEvent.findMany({
          where: { userId, startTime: { lt: startOfTomorrow }, endTime: { gt: startOfToday } },
          orderBy: { startTime: 'asc' },
          select: EVENT_SELECT,
        }),
        prisma.calendarEvent.findMany({
          where: { userId, isAllDay: false, startTime: { gte: startOfTomorrow, lt: endOfTomorrow } },
          orderBy: { startTime: 'asc' },
          take: 3,
          select: EVENT_SELECT,
        }),
        taskService.findMyDay(userId),
        deadlineService.forRange(userId, startOfToday.toISOString(), startOfTomorrow.toISOString()),
        deadlineService.forRange(userId, startOfTomorrow.toISOString(), endOfTomorrow.toISOString()),
        repliesOwed(userId, now),
        pursuitsClosing(userId, now),
        waitingOnOthers(userId, now),
        quietAccounts(userId, now),
        prisma.task.findMany({
          where: { AND: [reachableTask, { status: { in: terminal } }, { updatedAt: { gte: startOfToday } }] },
          orderBy: { updatedAt: 'desc' },
          select: { id: true, title: true },
        }),
        prisma.task.findMany({
          where: { AND: [reachableTask, notTerminal(terminal), { dueDate: { gte: startOfTomorrow, lt: endOfTomorrow } }] },
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          take: 3,
          select: { id: true, title: true, dueDate: true },
        }),
      ]);

    // The next meeting still to come today, with what to know walking in.
    const next = (events as EventRow[]).find((e) => !e.isAllDay && e.endTime > now) ?? null;
    const nextUp = next ? { event: toTodayEvent(next), prep: await meetingPrep(userId, next) } : null;

    // Tomorrow's first three, whatever they are.
    const tomorrow = [
      ...(tomorrowEvents as EventRow[]).map((e) => ({ kind: 'EVENT' as const, id: e.id, title: e.title, at: e.startTime })),
      ...deadlinesTomorrow
        .filter((d: Deadline) => d.kind !== 'TASK_DUE')
        .map((d: Deadline) => ({ kind: d.kind, id: d.id, title: d.title, at: d.at })),
      ...dueTomorrow.map((t) => ({ kind: 'TASK_DUE' as const, id: t.id, title: t.title, at: t.dueDate! })),
    ]
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .slice(0, 3);

    return {
      timezone: tz,
      today: startOfToday,
      events: (events as EventRow[]).map(toTodayEvent),
      tasks: { overdue: myDay.data.overdue, dueToday: myDay.data.dueToday, startingToday: myDay.data.startingToday },
      // Task due dates arrive with the tasks; these are the tender dates.
      deadlines: deadlinesToday.filter((d) => d.kind !== 'TASK_DUE'),
      repliesOwed: owed,
      pursuits,
      waitingOnOthers: waiting,
      quietAccounts: quiet,
      nextUp,
      wrapUp: {
        finished: finishedToday,
        slipped: myDay.data.dueToday.map((t) => ({ id: t.id, title: t.title })),
        tomorrow,
      },
    };
  },
};
