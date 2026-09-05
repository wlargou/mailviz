import { describe, it, expect, vi, afterEach } from 'vitest';
import { dashboardService } from './dashboardService.js';
import { prisma } from '../lib/prisma.js';
import {
  createTwoUsers,
  createTask,
  createEmail,
  createCustomer,
  createContact,
  createDealPartner,
  createGoogleAuth,
  seedTaskStatuses,
} from '../test/factories.js';

/**
 * The dashboard is one call that aggregates across seven tables, and roughly
 * half of it is hand-written SQL:
 *
 *   - three `$queryRaw` aggregates (tasks, emails, customers + contacts),
 *   - a `groupBy` for top customers and another for task status,
 *   - a raw 14-day email-volume rollup,
 *   - and a `findMany` per section for the "recent"/"upcoming" lists.
 *
 * Raw SQL is where the multi-tenant guarantee is weakest: Prisma cannot help,
 * the `WHERE user_id = $1` is a string away from being dropped, and the
 * contacts count reaches the owner through a join (`contacts` has no user_id of
 * its own) so it is the easiest of the lot to get wrong. Every counter here is
 * a number rendered on the first screen after login, so a leak shows up as
 * "why does my dashboard say 40 emails when I have 3" rather than anything
 * alarming enough to be reported as a breach.
 *
 * The headline test is therefore the empty-account one: a brand-new user next
 * to a database full of somebody else's rows must see zeros everywhere. The
 * per-section tests then give both users data and pin the arithmetic down.
 */

// ── local fixtures ────────────────────────────────────────────────────────────
// Calendar events, deals with expiry dates and tasks with due dates are all
// needed here and are not in the shared factories, so they are built directly.

/**
 * The zone this machine runs in.
 *
 * Every fixture below is built with `new Date(y, m, d, h)`, which is local
 * wall-clock. The dashboard now computes its day and week boundaries in the
 * USER's zone, so a user whose timezone is null (meaning UTC) would have those
 * fixtures land on the wrong side of midnight anywhere but a UTC machine —
 * the same class of bug the feature exists to fix, reproduced in the tests.
 *
 * Setting the fixture user's timezone to the machine's makes that assumption
 * explicit and keeps these tests about what they were about. The timezone
 * behaviour itself is asserted separately, with fixed instants and real zones.
 */
const MACHINE_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Give a user the machine's zone so local-wall-clock fixtures line up. */
async function inMachineZone(userId: string): Promise<string> {
  await prisma.user.update({ where: { id: userId }, data: { timezone: MACHINE_TZ } });
  return userId;
}

function startOfLocalToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** N days from local midnight today, at the given local hour. */
function dayOffset(days: number, hours = 0): Date {
  const d = startOfLocalToday();
  d.setDate(d.getDate() + days);
  d.setHours(hours);
  return d;
}

/** The same YYYY-MM-DD the chart axis uses. */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function seedEvent(
  userId: string,
  opts: { title: string; startTime: Date; endTime: Date; isAllDay?: boolean }
) {
  return prisma.calendarEvent.create({
    data: {
      userId,
      title: opts.title,
      startTime: opts.startTime,
      endTime: opts.endTime,
      isAllDay: opts.isAllDay ?? false,
    },
  });
}

async function seedTask(
  userId: string,
  opts: { title: string; status?: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; dueDate?: Date; customerId?: string }
) {
  return prisma.task.create({
    data: {
      userId,
      title: opts.title,
      status: opts.status ?? 'TODO',
      ...(opts.priority ? { priority: opts.priority } : {}),
      ...(opts.dueDate ? { dueDate: opts.dueDate } : {}),
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
    },
  });
}

async function seedDeal(
  userId: string,
  opts: { title: string; expiryDate?: Date | null; status?: string }
) {
  const partner = await createDealPartner(userId);
  return prisma.deal.create({
    data: {
      userId,
      partnerId: partner.id,
      title: opts.title,
      ...(opts.expiryDate ? { expiryDate: opts.expiryDate } : {}),
      ...(opts.status ? { status: opts.status } : {}),
    },
  });
}

/** A full spread of rows for one user — used as the "other tenant" background. */
async function seedBusyUser(userId: string) {
  await createGoogleAuth(userId, { email: `busy-${userId}@example.com` });
  await seedTask(userId, { title: 'Busy done', status: 'DONE', priority: 'HIGH' });
  await seedTask(userId, { title: 'Busy overdue', status: 'TODO', priority: 'URGENT', dueDate: dayOffset(-2, 9) });
  await seedTask(userId, { title: 'Busy open', status: 'IN_PROGRESS', priority: 'LOW' });

  const customer = await createCustomer(userId, { name: 'Busy Corp' });
  await createContact(customer.id);
  await createContact(customer.id);

  await createEmail(userId, { isRead: false, receivedAt: new Date(), customerId: customer.id });
  await createEmail(userId, { isRead: false, receivedAt: dayOffset(-1, 12), customerId: customer.id });
  await createEmail(userId, { isRead: true, receivedAt: new Date() });

  await seedEvent(userId, { title: 'Busy standup', startTime: dayOffset(0, 9), endTime: dayOffset(0, 10) });
  await seedEvent(userId, { title: 'Busy later', startTime: dayOffset(2, 14), endTime: dayOffset(2, 15) });

  await seedDeal(userId, { title: 'Busy renewal', expiryDate: dayOffset(5, 12) });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('dashboardService.getStats — a user sees only their own numbers', () => {
  /**
   * The one test that covers every aggregate at once. If any `WHERE user_id`
   * goes missing — including the one reached through the contacts→customers
   * join, and the ones inside raw SQL — a number here stops being zero.
   */
  it('reports zeros for an account with no data, however full the database is', async () => {
    const { alice, bob } = await createTwoUsers();
    await seedBusyUser(bob.id);

    const stats = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(stats.tasks.total).toBe(0);
    expect(stats.tasks.completed).toBe(0);
    expect(stats.tasks.overdue).toBe(0);
    expect(stats.tasks.inProgress).toBe(0);
    expect(stats.tasks.byPriority).toEqual({ LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 });
    expect(stats.tasks.recentTasks).toEqual([]);

    expect(stats.emails.unreadCount).toBe(0);
    expect(stats.emails.unreadTodayCount).toBe(0);
    expect(stats.emails.totalSynced).toBe(0);
    expect(stats.emails.recentEmails).toEqual([]);

    expect(stats.calendar.eventsToday).toBe(0);
    expect(stats.calendar.eventsThisWeek).toBe(0);
    expect(stats.calendar.upcomingEvents).toEqual([]);
    expect(stats.calendar.meetingHoursThisWeek).toBe(0);
    expect(stats.calendar.meetingCountThisWeek).toBe(0);

    expect(stats.customers.totalCustomers).toBe(0);
    expect(stats.customers.totalContacts).toBe(0);
    expect(stats.customers.topCustomers).toEqual([]);

    expect(stats.charts.taskStatusCounts).toEqual({});
    expect(stats.expiringDeals).toEqual([]);

    // The chart axis is always 14 days wide, even with nothing to plot.
    expect(stats.charts.emailVolume).toHaveLength(14);
    expect(stats.charts.emailVolume.every((d) => d.sent === 0 && d.received === 0)).toBe(true);
  });
});

describe('dashboardService.getStats — tasks', () => {
  it('counts total, completed, overdue and in-progress for the caller only', async () => {
    const { alice, bob } = await createTwoUsers();
    // Finished-vs-outstanding now depends on a status marked terminal.
    await seedTaskStatuses(alice.id);
    await seedBusyUser(bob.id);

    await seedTask(alice.id, { title: 'Shipped', status: 'DONE', priority: 'HIGH' });
    await seedTask(alice.id, { title: 'Late', status: 'TODO', priority: 'URGENT', dueDate: dayOffset(-3, 9) });
    await seedTask(alice.id, { title: 'Open', status: 'IN_PROGRESS', priority: 'LOW' });
    await seedTask(alice.id, { title: 'Future', status: 'TODO', priority: 'MEDIUM', dueDate: dayOffset(3, 9) });

    const { tasks } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(tasks.total).toBe(4);
    expect(tasks.completed).toBe(1);
    expect(tasks.overdue).toBe(1);
    expect(tasks.inProgress).toBe(3);
    expect(tasks.byPriority).toEqual({ LOW: 1, MEDIUM: 1, HIGH: 1, URGENT: 1 });
  });

  /** Nagging a user about work they already finished is the visible symptom. */
  it('does not call a completed task overdue, however old its due date', async () => {
    const { alice } = await createTwoUsers();
    // Finished-vs-outstanding now depends on a status marked terminal.
    await seedTaskStatuses(alice.id);
    await seedTask(alice.id, { title: 'Done but late', status: 'DONE', dueDate: dayOffset(-30, 9) });

    const { tasks } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(tasks.completed).toBe(1);
    expect(tasks.overdue).toBe(0);
  });

  /** Task statuses are user-defined rows, not an enum — the donut reads this map. */
  it('groups the status donut by the caller’s own dynamic statuses', async () => {
    const { alice, bob } = await createTwoUsers();
    await seedTask(bob.id, { title: 'Bob blocked', status: 'BLOCKED' });
    await seedTask(alice.id, { title: 'a', status: 'IN_REVIEW' });
    await seedTask(alice.id, { title: 'b', status: 'IN_REVIEW' });
    await seedTask(alice.id, { title: 'c', status: 'DONE' });

    const { charts } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(charts.taskStatusCounts).toEqual({ IN_REVIEW: 2, DONE: 1 });
  });

  it('returns the five newest tasks, newest first', async () => {
    const { alice, bob } = await createTwoUsers();
    // Timestamps are pinned a minute apart rather than left to the default.
    // Prisma maps DateTime to timestamp(3), so seven rows written in a tight
    // loop can share a millisecond — and tied rows come back in whatever order
    // the tiebreaker gives, which is uuid order and therefore unrelated to
    // creation order. Without this the case failed about half the time.
    for (let i = 1; i <= 7; i++) {
      const task = await createTask(alice.id, { title: `task-${i}` });
      await prisma.task.update({
        where: { id: task.id },
        data: { createdAt: new Date(Date.UTC(2026, 0, 1, 12, i)) },
      });
    }
    // Newest of all, so it would head the list if ownership were dropped.
    const bobTask = await createTask(bob.id, { title: 'Bob task' });
    await prisma.task.update({
      where: { id: bobTask.id },
      data: { createdAt: new Date(Date.UTC(2026, 0, 1, 13, 0)) },
    });

    const { tasks } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(tasks.recentTasks.map((t) => t.title)).toEqual([
      'task-7',
      'task-6',
      'task-5',
      'task-4',
      'task-3',
    ]);
  });

  /**
   * `recentTasks` flattens the TaskLabel join rows into plain labels. The
   * dashboard renders label chips straight from this — leave the join rows in
   * and every chip loses its name and colour.
   */
  it('flattens task labels and inlines the customer', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { name: 'Acme' });
    const label = await prisma.label.create({ data: { userId: alice.id, name: 'urgent', color: '#ff0000' } });
    const task = await seedTask(alice.id, { title: 'Labelled', customerId: customer.id });
    await prisma.taskLabel.create({ data: { taskId: task.id, labelId: label.id } });

    const { tasks } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(tasks.recentTasks[0].labels).toEqual([expect.objectContaining({ name: 'urgent', color: '#ff0000' })]);
    expect(tasks.recentTasks[0].customer).toEqual({ id: customer.id, name: 'Acme', company: null });
  });
});

describe('dashboardService.getStats — emails', () => {
  it('counts unread, unread-today and total for the caller only', async () => {
    const { alice, bob } = await createTwoUsers();
    await seedBusyUser(bob.id);

    await createEmail(alice.id, { isRead: false, receivedAt: new Date() });
    await createEmail(alice.id, { isRead: false, receivedAt: dayOffset(-3, 10) });
    await createEmail(alice.id, { isRead: true, receivedAt: new Date() });

    const { emails } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(emails.totalSynced).toBe(3);
    expect(emails.unreadCount).toBe(2);
    // "Today" is local midnight onwards — the three-day-old unread does not count.
    expect(emails.unreadTodayCount).toBe(1);
  });

  /**
   * The recent list is a thread list, not a message list. Without the distinct
   * a chatty thread fills the whole panel with its own replies.
   */
  it('shows one row per thread, newest first', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 't-1', subject: 'Chatty first', receivedAt: dayOffset(-2, 9) });
    await createEmail(alice.id, { threadId: 't-1', subject: 'Chatty reply', receivedAt: dayOffset(0, 9) });
    await createEmail(alice.id, { threadId: 't-2', subject: 'Other thread', receivedAt: dayOffset(-1, 9) });

    const { emails } = await dashboardService.getStats(await inMachineZone(alice.id));

    const threadIds = emails.recentEmails.map((e) => e.threadId);
    expect(new Set(threadIds).size).toBe(threadIds.length);
    expect(threadIds).toEqual(['t-1', 't-2']);
    expect(emails.recentEmails[0].subject).toBe('Chatty reply');
  });

  it('caps the recent list at eight threads', async () => {
    const { alice } = await createTwoUsers();
    for (let i = 0; i < 11; i++) {
      await createEmail(alice.id, { threadId: `t-${i}`, receivedAt: new Date(Date.now() - i * 60_000) });
    }

    const { emails } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(emails.recentEmails).toHaveLength(8);
  });

  it('never shows another user’s mail in the recent list', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(bob.id, { subject: 'Bob private' });
    await createEmail(alice.id, { subject: 'Alice mail' });

    const { emails } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(emails.recentEmails.map((e) => e.subject)).toEqual(['Alice mail']);
  });
});

describe('dashboardService.getStats — email volume chart', () => {
  /**
   * The axis has to be a fixed 14-day window regardless of which days have
   * mail, or the chart's x-axis jumps around between refreshes.
   */
  it('emits fourteen consecutive days ending today', async () => {
    const { alice } = await createTwoUsers();

    const { charts } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(charts.emailVolume).toHaveLength(14);
    expect(charts.emailVolume.map((d) => d.date)).toEqual(
      Array.from({ length: 14 }, (_, i) => localDateKey(dayOffset(i - 13)))
    );
  });

  /**
   * The sent/received split is driven by matching the Google account address
   * against the From header, and the window is bounded — mail older than the
   * window and mail belonging to another user must both stay out.
   *
   * Totals are summed across the window rather than pinned to one bucket: the
   * rollup groups by the database's date and the axis is built from local
   * dates, so on a non-UTC server a message near midnight legitimately lands in
   * the adjacent bucket.
   */
  it('splits sent from received and counts only the caller’s recent mail', async () => {
    const { alice, bob } = await createTwoUsers();
    await createGoogleAuth(alice.id, { email: 'alice@corp.example' });
    await createGoogleAuth(bob.id, { email: 'bob@corp.example' });

    await createEmail(alice.id, { from: 'Alice <alice@corp.example>', receivedAt: dayOffset(-1, 12) });
    await createEmail(alice.id, { from: 'someone@elsewhere.example', receivedAt: dayOffset(-1, 13) });
    await createEmail(alice.id, { from: 'other@elsewhere.example', receivedAt: dayOffset(-2, 13) });
    // Outside the 14-day window.
    await createEmail(alice.id, { from: 'ancient@elsewhere.example', receivedAt: dayOffset(-40, 12) });
    // Bob's, and Bob is a busy man.
    for (let i = 0; i < 6; i++) {
      await createEmail(bob.id, { from: 'bob@corp.example', receivedAt: dayOffset(-1, 12) });
    }

    const { charts } = await dashboardService.getStats(await inMachineZone(alice.id));

    const sent = charts.emailVolume.reduce((n, d) => n + d.sent, 0);
    const received = charts.emailVolume.reduce((n, d) => n + d.received, 0);
    expect(sent).toBe(1);
    expect(received).toBe(2);
  });
});

describe('dashboardService.getStats — calendar', () => {
  it('separates today from the week and excludes all-day events from meeting load', async () => {
    const { alice, bob } = await createTwoUsers();
    await seedBusyUser(bob.id);

    await seedEvent(alice.id, { title: 'Morning sync', startTime: dayOffset(0, 9), endTime: dayOffset(0, 10) });
    await seedEvent(alice.id, { title: 'Midday review', startTime: dayOffset(0, 11), endTime: dayOffset(0, 13) });
    await seedEvent(alice.id, {
      title: 'Company holiday',
      startTime: dayOffset(0, 0),
      endTime: dayOffset(1, 0),
      isAllDay: true,
    });
    /**
     * Still inside this week, whatever today is.
     *
     * The week ends next Monday, and `eventsThisWeek` counts from today to
     * that boundary — so a fixed "+2 days" left the week on Saturday and
     * Sunday, and this test failed every weekend (CI run 33992087482, a
     * docs-only PR). `laterInWeek` is the number of days ahead that still
     * lands before the boundary: two where there is room, one on Saturday,
     * and zero on Sunday, when nothing after today is this week and the event
     * has to be later today instead.
     */
    const daysUntilWeekEnd = (8 - new Date().getDay()) % 7 || 7;
    const laterInWeek = Math.min(2, daysUntilWeekEnd - 1);
    await seedEvent(alice.id, {
      title: 'Later this week',
      startTime: dayOffset(laterInWeek, 14),
      endTime: dayOffset(laterInWeek, 15),
    });
    // Far outside the window in both directions. Without these the query had no
    // bounds to get wrong: dropping the date filter altogether changed none of
    // the counters, because every fixture was already inside the week.
    await seedEvent(alice.id, { title: 'Last month', startTime: dayOffset(-30, 10), endTime: dayOffset(-30, 11) });
    await seedEvent(alice.id, { title: 'Next month', startTime: dayOffset(30, 10), endTime: dayOffset(30, 11) });

    const { calendar } = await dashboardService.getStats(await inMachineZone(alice.id));

    // On a Sunday the fourth event is today as well.
    expect(calendar.eventsToday).toBe(laterInWeek === 0 ? 4 : 3);
    expect(calendar.eventsThisWeek).toBe(4);
    // All-day events are not meetings, so they add no hours and no count.
    expect(calendar.meetingCountThisWeek).toBe(3);
    expect(calendar.meetingHoursThisWeek).toBe(4);
  });

  it('lists the next five events and drops anything already started', async () => {
    const { alice } = await createTwoUsers();
    const now = new Date();
    await seedEvent(alice.id, { title: 'already started', startTime: dayOffset(0, 0), endTime: dayOffset(0, 1) });
    for (let i = 1; i <= 6; i++) {
      const start = new Date(now.getTime() + i * 3_600_000);
      await seedEvent(alice.id, {
        title: `in ${i}h`,
        startTime: start,
        endTime: new Date(start.getTime() + 1_800_000),
      });
    }

    const { calendar } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(calendar.upcomingEvents.map((e) => e.title)).toEqual(['in 1h', 'in 2h', 'in 3h', 'in 4h', 'in 5h']);
  });

  it('never counts another user’s events', async () => {
    const { alice, bob } = await createTwoUsers();
    for (let i = 0; i < 4; i++) {
      await seedEvent(bob.id, { title: `Bob ${i}`, startTime: dayOffset(0, 9), endTime: dayOffset(0, 10) });
    }
    await seedEvent(alice.id, { title: 'Alice only', startTime: dayOffset(0, 15), endTime: dayOffset(0, 16) });

    const { calendar } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(calendar.eventsToday).toBe(1);
    expect(calendar.meetingHoursThisWeek).toBe(1);
    expect(calendar.upcomingEvents.map((e) => e.title)).not.toContain('Bob 0');
  });
});

describe('dashboardService.getStats — customers and contacts', () => {
  /**
   * `contacts` has no user_id — the count reaches its owner through a join to
   * `customers`. Break the join and the number becomes every user's contacts.
   */
  it('counts contacts through the customer join, scoped to the caller', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCustomer = await createCustomer(bob.id, { name: 'Bob Corp' });
    await createContact(bobCustomer.id);
    await createContact(bobCustomer.id);
    await createContact(bobCustomer.id);

    const aliceOne = await createCustomer(alice.id, { name: 'Alice One' });
    const aliceTwo = await createCustomer(alice.id, { name: 'Alice Two' });
    await createContact(aliceOne.id);
    await createContact(aliceTwo.id);

    const { customers } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(customers.totalCustomers).toBe(2);
    expect(customers.totalContacts).toBe(2);
  });

  it('ranks top customers by email count and attaches their task counts', async () => {
    const { alice, bob } = await createTwoUsers();

    const busiest = await createCustomer(alice.id, { name: 'Busiest' });
    const quieter = await createCustomer(alice.id, { name: 'Quieter' });
    for (let i = 0; i < 3; i++) await createEmail(alice.id, { customerId: busiest.id });
    await createEmail(alice.id, { customerId: quieter.id });
    // Unlinked mail must not create a phantom entry.
    await createEmail(alice.id);
    await seedTask(alice.id, { title: 'For busiest', customerId: busiest.id });
    await seedTask(alice.id, { title: 'Also busiest', customerId: busiest.id });

    // Bob's customer has far more mail and must not appear in Alice's ranking.
    const bobCustomer = await createCustomer(bob.id, { name: 'Bob Loud' });
    for (let i = 0; i < 10; i++) await createEmail(bob.id, { customerId: bobCustomer.id });

    const { customers } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(customers.topCustomers.map((c) => c.name)).toEqual(['Busiest', 'Quieter']);
    expect(customers.topCustomers[0]).toMatchObject({ emailCount: 3, taskCount: 2 });
    expect(customers.topCustomers[1]).toMatchObject({ emailCount: 1, taskCount: 0 });
  });
});

describe('dashboardService.getStats — expiring deals', () => {
  it('returns only the caller’s deals expiring in the next fifteen days, soonest first', async () => {
    const { alice, bob } = await createTwoUsers();

    await seedDeal(alice.id, { title: 'Due in 2 days', expiryDate: dayOffset(2, 12) });
    await seedDeal(alice.id, { title: 'Due in 10 days', expiryDate: dayOffset(10, 12) });
    await seedDeal(alice.id, { title: 'Due in 40 days', expiryDate: dayOffset(40, 12) });
    await seedDeal(alice.id, { title: 'Already expired', expiryDate: dayOffset(-2, 12) });
    await seedDeal(alice.id, { title: 'No expiry' });
    // A declined deal is dead — chasing it would be noise.
    await seedDeal(alice.id, { title: 'Declined', expiryDate: dayOffset(3, 12), status: 'DECLINED' });
    await seedDeal(bob.id, { title: 'Bob deal', expiryDate: dayOffset(1, 12) });

    const { expiringDeals } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(expiringDeals.map((d) => d.title)).toEqual(['Due in 2 days', 'Due in 10 days']);
  });

  it('reports days until expiry and the partner and customer names', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { name: 'Acme' });
    const partner = await createDealPartner(alice.id, 'Distributor Ltd');
    await prisma.deal.create({
      data: {
        userId: alice.id,
        partnerId: partner.id,
        customerId: customer.id,
        title: 'Renewal',
        expiryDate: dayOffset(5, 12),
      },
    });

    const { expiringDeals } = await dashboardService.getStats(await inMachineZone(alice.id));

    expect(expiringDeals).toHaveLength(1);
    expect(expiringDeals[0].partner).toEqual({ name: 'Distributor Ltd' });
    expect(expiringDeals[0].customer).toEqual({ id: customer.id, name: 'Acme' });
    // Expiry is 5 days out at local noon, so the ceiling lands on 5 or 6.
    expect(expiringDeals[0].daysUntilExpiry).toBeGreaterThanOrEqual(5);
    expect(expiringDeals[0].daysUntilExpiry).toBeLessThanOrEqual(6);
  });
});

/**
 * "Today" and "this week" belong to the user, not to the server.
 *
 * Railway runs UTC. Before the timezone column, `new Date(y, m, d)` meant every
 * boundary was UTC midnight — 2am for a user in Paris, and still yesterday for
 * one in California. These fix the clock so the assertions describe a real
 * moment rather than whenever the suite happens to run.
 */
describe('dashboardService.getStats — the user’s own day', () => {
  const PARIS = 'Europe/Paris';
  const LA = 'America/Los_Angeles';

  afterEach(() => vi.useRealTimers());

  /**
   * 15 Jan 2026, 23:30 UTC. Paris is already on the 16th (00:30); LA is still
   * on the 15th (15:30); the server, on UTC, says the 15th.
   *
   * So a midday-UTC event on the 15th is TODAY for the server and for LA, and
   * YESTERDAY for Paris — which is the disagreement worth asserting. An event
   * just after midnight Paris time would have been "today" for all three, and
   * the first version of these tests used exactly that and proved nothing.
   */
  const ACROSS_MIDNIGHT = new Date('2026-01-15T23:30:00Z');
  const MIDDAY_15TH = '2026-01-15T12:00:00Z';

  async function seedAt(userId: string, iso: string, title: string) {
    return seedEvent(userId, {
      title,
      startTime: new Date(iso),
      endTime: new Date(new Date(iso).getTime() + 3600000),
    });
  }

  it('counts an event by the user’s calendar day, not the server’s', async () => {
    const { alice } = await createTwoUsers();
    await prisma.user.update({ where: { id: alice.id }, data: { timezone: PARIS } });
    // 13:00 on the 15th in Paris, where it is now the 16th — so: yesterday.
    // The server's UTC clock still says the 15th and would count it as today.
    await seedAt(alice.id, MIDDAY_15TH, 'Yesterday, in Paris');

    vi.setSystemTime(ACROSS_MIDNIGHT);
    const { calendar } = await dashboardService.getStats(alice.id);

    expect(calendar.eventsToday).toBe(0);
  });

  it('gives two users in different zones different answers for the same instant', async () => {
    // The clearest statement of the bug: one server clock, two correct answers.
    const { alice, bob } = await createTwoUsers();
    await prisma.user.update({ where: { id: alice.id }, data: { timezone: PARIS } });
    await prisma.user.update({ where: { id: bob.id }, data: { timezone: LA } });
    await seedAt(alice.id, MIDDAY_15TH, 'Midday UTC');
    await seedAt(bob.id, MIDDAY_15TH, 'Midday UTC');

    vi.setSystemTime(ACROSS_MIDNIGHT);
    const paris = await dashboardService.getStats(alice.id);
    const la = await dashboardService.getStats(bob.id);

    // Same row, same instant, same server clock: 13:00 yesterday in Paris,
    // 04:00 today in Los Angeles. Both answers are correct.
    expect(paris.calendar.eventsToday).toBe(0);
    expect(la.calendar.eventsToday).toBe(1);
  });

  it('falls back to UTC for an account that has never set a zone', async () => {
    // Every account before this column shipped. The fallback has to be the old
    // behaviour, not a new failure.
    const { alice } = await createTwoUsers();
    await seedAt(alice.id, MIDDAY_15TH, 'Midday UTC');

    vi.setSystemTime(ACROSS_MIDNIGHT);
    const { calendar } = await dashboardService.getStats(alice.id);

    // UTC still says the 15th, so this counts — the pre-column behaviour.
    expect(calendar.eventsToday).toBe(1);
  });

  it('does not let a malformed zone break the dashboard', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { alice } = await createTwoUsers();
    await prisma.user.update({ where: { id: alice.id }, data: { timezone: 'Mars/Olympus' } });

    vi.setSystemTime(ACROSS_MIDNIGHT);
    await expect(dashboardService.getStats(alice.id)).resolves.toBeDefined();

    warn.mockRestore();
  });
});

/**
 * "This week" has to be a week.
 *
 * `endOfWeek` was `startOfToday + 7` while `startOfWeek` was the Monday, so on
 * a Sunday the window spanned thirteen days and meeting hours counted most of
 * next week as this week's.
 */
describe('dashboardService.getStats — the week is seven days', () => {
  afterEach(() => vi.useRealTimers());

  it('excludes next week’s meetings when today is Sunday', async () => {
    const { alice } = await createTwoUsers();
    await prisma.user.update({ where: { id: alice.id }, data: { timezone: 'UTC' } });

    // Sunday 18 January 2026. The week began Monday the 12th and ends at
    // midnight on Monday the 19th.
    await seedEvent(alice.id, {
      title: 'This week', startTime: new Date('2026-01-14T10:00:00Z'), endTime: new Date('2026-01-14T12:00:00Z'),
    });
    // Tuesday the 20th — inside the old thirteen-day window, outside the week.
    await seedEvent(alice.id, {
      title: 'Next week', startTime: new Date('2026-01-20T10:00:00Z'), endTime: new Date('2026-01-20T14:00:00Z'),
    });

    vi.setSystemTime(new Date('2026-01-18T12:00:00Z'));
    const { calendar } = await dashboardService.getStats(alice.id);

    expect(calendar.meetingHoursThisWeek).toBe(2);
    expect(calendar.meetingCountThisWeek).toBe(1);
  });

  it('still lists upcoming events beyond the end of the week', async () => {
    // The fetch window has to outrun the week, or the upcoming list empties out
    // every Friday. Narrowing both together would have been the easy mistake.
    const { alice } = await createTwoUsers();
    await prisma.user.update({ where: { id: alice.id }, data: { timezone: 'UTC' } });
    await seedEvent(alice.id, {
      title: 'Early next week', startTime: new Date('2026-01-20T10:00:00Z'), endTime: new Date('2026-01-20T11:00:00Z'),
    });

    vi.setSystemTime(new Date('2026-01-18T12:00:00Z'));
    const { calendar } = await dashboardService.getStats(alice.id);

    expect(calendar.upcomingEvents.map((e) => e.title)).toContain('Early next week');
  });
});
