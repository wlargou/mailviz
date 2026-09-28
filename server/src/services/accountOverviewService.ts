import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { RFP_TERMINAL_STATUSES } from '../utils/rfp.js';
import { getSharedRfpIds, getSharedTaskIds, getSharedDealIds } from '../utils/accessControl.js';
import { terminalStatusNames, notTerminal } from '../utils/taskStatus.js';

/**
 * An account at a glance: how the relationship is going, what is open with
 * them, and who matters there — then everything that happened, interleaved.
 *
 * The company page opened on 193 contacts sorted by the first letter of a
 * generated name, with no tender or deal anywhere on it. It should answer
 * "how are we doing with this customer?" in five seconds; this is the data
 * for that answer.
 */

const WEEKS = 12;
const DAY = 86_400_000;
const TIMELINE_PAGE = 30;

async function ownedCustomer(userId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, userId }, select: { id: true } });
  if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
}

/** The Monday 00:00 UTC that starts the week containing `d`. */
function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7;
  return new Date(x.getTime() - dow * DAY);
}

export type TimelineKind = 'THREAD' | 'MEETING' | 'TASK' | 'TENDER' | 'DEAL';

export interface TimelineEntry {
  kind: TimelineKind;
  id: string;
  title: string;
  /** Who, for mail; the status, for work. */
  detail: string | null;
  at: Date;
  /** For a thread: its id, which the mail reader opens. */
  threadId?: string | null;
}

export const accountOverviewService = {
  async overview(userId: string, customerId: string, now = new Date()) {
    await ownedCustomer(userId, customerId);
    const since = weekStart(new Date(now.getTime() - (WEEKS - 1) * 7 * DAY));

    const [sharedTaskIds, sharedRfpIds, sharedDealIds, terminal] = await Promise.all([
      getSharedTaskIds(userId), getSharedRfpIds(userId), getSharedDealIds(userId), terminalStatusNames(userId),
    ]);

    const [lastMail, lastMeeting, mailWeeks, meetingWeeks, openTasks, openTaskCount, tenders, deals, people] = await Promise.all([
      prisma.email.findFirst({
        where: { userId, customerId, receivedAt: { lte: now } },
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true },
      }),
      prisma.calendarEvent.findFirst({
        where: { userId, startTime: { lte: now }, customers: { some: { customerId } } },
        orderBy: { startTime: 'desc' },
        select: { startTime: true },
      }),
      prisma.$queryRaw<Array<{ week: Date; n: bigint }>>`
        SELECT date_trunc('week', received_at AT TIME ZONE 'UTC') AS week, COUNT(*) AS n
        FROM emails WHERE user_id = ${userId} AND customer_id = ${customerId}
          AND received_at >= ${since} AND received_at <= ${now}
        GROUP BY 1
      `,
      prisma.$queryRaw<Array<{ week: Date; n: bigint }>>`
        SELECT date_trunc('week', ev.start_time AT TIME ZONE 'UTC') AS week, COUNT(*) AS n
        FROM calendar_events ev JOIN calendar_event_customers cec ON cec.calendar_event_id = ev.id
        WHERE ev.user_id = ${userId} AND cec.customer_id = ${customerId}
          AND ev.start_time >= ${since} AND ev.start_time <= ${now}
        GROUP BY 1
      `,
      prisma.task.findMany({
        where: {
          AND: [
            { customerId },
            { OR: [{ userId }, { assignedToId: userId }, ...(sharedTaskIds.length ? [{ id: { in: sharedTaskIds } }] : [])] },
            notTerminal(terminal),
          ],
        },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        take: 5,
        select: { id: true, title: true, dueDate: true, priority: true, status: true },
      }),
      prisma.task.count({
        where: {
          AND: [
            { customerId },
            { OR: [{ userId }, { assignedToId: userId }, ...(sharedTaskIds.length ? [{ id: { in: sharedTaskIds } }] : [])] },
            notTerminal(terminal),
          ],
        },
      }),
      prisma.rfp.findMany({
        where: {
          AND: [
            { customerId },
            { OR: [{ userId }, ...(sharedRfpIds.length ? [{ id: { in: sharedRfpIds } }] : [])] },
            { status: { notIn: [...RFP_TERMINAL_STATUSES] } },
          ],
        },
        orderBy: { deadlineAt: 'asc' },
        select: { id: true, name: true, reference: true, status: true, deadlineAt: true },
      }),
      prisma.deal.findMany({
        where: {
          AND: [
            { customerId },
            { OR: [{ userId }, ...(sharedDealIds.length ? [{ id: { in: sharedDealIds } }] : [])] },
            { status: { not: 'DECLINED' } },
          ],
        },
        orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }],
        select: { id: true, title: true, status: true, expiryDate: true, partner: { select: { name: true } } },
      }),
      // People by exchanges: mail from them, or with them among the
      // recipients, among the mail filed under this account.
      prisma.$queryRaw<Array<{ id: string; first_name: string; last_name: string; email: string | null; role: string | null; n: bigint; last_at: Date | null }>>`
        SELECT c.id, c.first_name, c.last_name, c.email, c.role, COUNT(e.id) AS n, MAX(e.received_at) AS last_at
        FROM contacts c
        JOIN emails e ON e.user_id = ${userId} AND e.customer_id = ${customerId}
          AND c.email IS NOT NULL
          AND (lower(e."from") = lower(c.email)
               OR position(lower(c.email) IN lower(array_to_string(e."to", ','))) > 0)
        WHERE c.customer_id = ${customerId} AND c.kind = 'person'
        GROUP BY c.id
        ORDER BY n DESC, c.id
        LIMIT 5
      `,
    ]);

    const byWeek = (rows: Array<{ week: Date; n: bigint }>) =>
      new Map(rows.map((r) => [weekStart(new Date(r.week)).getTime(), Number(r.n)]));
    const mails = byWeek(mailWeeks);
    const meets = byWeek(meetingWeeks);
    const weekly = Array.from({ length: WEEKS }, (_, i) => {
      const start = new Date(since.getTime() + i * 7 * DAY);
      return { weekStart: start, emails: mails.get(start.getTime()) ?? 0, meetings: meets.get(start.getTime()) ?? 0 };
    });

    const touches = [lastMail?.receivedAt, lastMeeting?.startTime].filter(Boolean) as Date[];
    const lastTouchAt = touches.length ? new Date(Math.max(...touches.map((d) => d.getTime()))) : null;

    return {
      lastTouchAt,
      weekly,
      open: { tasks: openTasks, taskCount: openTaskCount, tenders, deals },
      keyPeople: people.map((p) => ({
        id: p.id,
        name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.email,
        email: p.email,
        role: p.role,
        exchanges: Number(p.n),
        lastAt: p.last_at,
      })),
    };
  },

  /**
   * Mail threads, meetings, tasks, tenders and deals with this account, newest
   * first, a page at a time: pass the last entry's `at` back as `before`.
   * A thread appears once, at its latest message.
   */
  async timeline(userId: string, customerId: string, beforeIso?: string) {
    await ownedCustomer(userId, customerId);
    const before = beforeIso ? new Date(beforeIso) : new Date();
    if (Number.isNaN(before.getTime())) throw new AppError(400, 'INVALID_BEFORE', 'before must be an ISO date');

    const [threads, meetings, tasks, tenders, deals] = await Promise.all([
      prisma.$queryRaw<Array<{ id: string; thread_id: string | null; subject: string; from: string; from_name: string | null; received_at: Date }>>`
        SELECT * FROM (
          SELECT DISTINCT ON (COALESCE(thread_id, id)) id, thread_id, subject, "from", from_name, received_at
          FROM emails
          WHERE user_id = ${userId} AND customer_id = ${customerId} AND NOT is_trashed
          ORDER BY COALESCE(thread_id, id), received_at DESC
        ) latest
        WHERE received_at < ${before}
        ORDER BY received_at DESC
        LIMIT ${TIMELINE_PAGE}
      `,
      prisma.calendarEvent.findMany({
        where: { userId, startTime: { lt: before }, customers: { some: { customerId } } },
        orderBy: { startTime: 'desc' },
        take: TIMELINE_PAGE,
        select: { id: true, title: true, startTime: true, location: true },
      }),
      prisma.task.findMany({
        where: { userId, customerId, createdAt: { lt: before } },
        orderBy: { createdAt: 'desc' },
        take: TIMELINE_PAGE,
        select: { id: true, title: true, status: true, createdAt: true },
      }),
      prisma.rfp.findMany({
        where: { userId, customerId, createdAt: { lt: before } },
        orderBy: { createdAt: 'desc' },
        take: TIMELINE_PAGE,
        select: { id: true, name: true, status: true, createdAt: true },
      }),
      prisma.deal.findMany({
        where: { userId, customerId, createdAt: { lt: before } },
        orderBy: { createdAt: 'desc' },
        take: TIMELINE_PAGE,
        select: { id: true, title: true, status: true, createdAt: true },
      }),
    ]);

    const entries: TimelineEntry[] = [
      ...threads.map((t) => ({ kind: 'THREAD' as const, id: t.id, threadId: t.thread_id, title: t.subject, detail: t.from_name || t.from, at: t.received_at })),
      ...meetings.map((m) => ({ kind: 'MEETING' as const, id: m.id, title: m.title, detail: m.location, at: m.startTime })),
      ...tasks.map((t) => ({ kind: 'TASK' as const, id: t.id, title: t.title, detail: t.status, at: t.createdAt })),
      ...tenders.map((r) => ({ kind: 'TENDER' as const, id: r.id, title: r.name, detail: r.status, at: r.createdAt })),
      ...deals.map((d) => ({ kind: 'DEAL' as const, id: d.id, title: d.title, detail: d.status, at: d.createdAt })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, TIMELINE_PAGE);

    // Each source was cut at the page size, so the merged page is complete
    // up to its last entry; the next page starts there.
    return {
      entries,
      nextBefore: entries.length === TIMELINE_PAGE ? entries[entries.length - 1].at : null,
    };
  },
};
