import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function subDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() - days);
  return result;
}

export const dashboardService = {
  /**
   * P2: Reorganized into 3 sequential batches instead of 18+ parallel queries.
   * Batch 1: Core stats (7 queries — tasks, emails, calendar, customers)
   * Batch 2: Raw SQL aggregates (email volume, needs attention, frequent contacts)
   * Batch 3: Post-processing lookups (top customer details)
   */
  async getStats(userId: string) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const endOfWeek = new Date(startOfToday);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const fourteenDaysAgo = new Date(startOfToday);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    // Monday of current week
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - ((dayOfWeek + 6) % 7));

    // Get user email for sent/received distinction
    const authRecord = await prisma.googleAuth.findFirst({ where: { userId }, select: { email: true } });
    const userEmail = authRecord?.email ?? '';

    // ── Batch 1: Core Prisma queries (7 queries, within Prisma pool limits) ──
    const [
      taskAggregates,
      recentTasks,
      tasksDueToday,
      emailStats,
      recentUnreadEmails,
      calendarData,
      customerCounts,
    ] = await Promise.all([
      // Single raw query replaces 4 separate task queries (total, completed, overdue, byPriority, byStatus)
      prisma.$queryRaw<Array<{
        total: bigint;
        completed: bigint;
        overdue: bigint;
        low: bigint;
        medium: bigint;
        high: bigint;
        urgent: bigint;
      }>>`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'DONE') as completed,
          COUNT(*) FILTER (WHERE status != 'DONE' AND due_date < ${now}) as overdue,
          COUNT(*) FILTER (WHERE priority = 'LOW') as low,
          COUNT(*) FILTER (WHERE priority = 'MEDIUM') as medium,
          COUNT(*) FILTER (WHERE priority = 'HIGH') as high,
          COUNT(*) FILTER (WHERE priority = 'URGENT') as urgent
        FROM tasks
        WHERE user_id = ${userId}
      `,

      // Recent tasks (needs include, can't be raw)
      prisma.task.findMany({
        where: { userId },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          labels: { include: { label: true } },
          customer: { select: { id: true, name: true, company: true } },
        },
      }),

      // Tasks due today
      prisma.task.findMany({
        where: {
          userId,
          status: { not: 'DONE' },
          dueDate: { gte: startOfToday, lt: endOfToday },
        },
        orderBy: { dueDate: 'asc' },
        select: { id: true, title: true, priority: true, status: true, dueDate: true },
      }),

      // Single raw query replaces 3 separate email count queries
      prisma.$queryRaw<Array<{
        unread_count: bigint;
        unread_today_count: bigint;
        total_synced: bigint;
      }>>`
        SELECT
          COUNT(*) FILTER (WHERE is_read = false) as unread_count,
          COUNT(*) FILTER (WHERE is_read = false AND received_at >= ${startOfToday}) as unread_today_count,
          COUNT(*) as total_synced
        FROM emails
        WHERE user_id = ${userId}
      `,

      // Recent unread (needs distinct, better as Prisma query)
      prisma.email.findMany({
        where: { userId, isRead: false },
        distinct: ['threadId'],
        orderBy: { receivedAt: 'desc' },
        take: 5,
        select: {
          threadId: true,
          subject: true,
          from: true,
          fromName: true,
          receivedAt: true,
          snippet: true,
        },
      }),

      // Single query for all calendar data this week (replaces 5 separate queries)
      // We fetch all events from startOfToday to endOfWeek, then filter in JS
      prisma.calendarEvent.findMany({
        where: { userId, startTime: { gte: startOfWeek, lt: endOfWeek } },
        orderBy: { startTime: 'asc' },
        select: {
          id: true,
          title: true,
          startTime: true,
          endTime: true,
          isAllDay: true,
          location: true,
          conferenceLink: true,
        },
      }),

      // Single raw query replaces 2 customer/contact counts + top customers groupBy
      prisma.$queryRaw<Array<{
        total_customers: bigint;
        total_contacts: bigint;
      }>>`
        SELECT
          (SELECT COUNT(*) FROM customers WHERE user_id = ${userId}) as total_customers,
          (SELECT COUNT(*) FROM contacts co JOIN customers cu ON co.customer_id = cu.id WHERE cu.user_id = ${userId}) as total_contacts
      `,
    ]);

    // ── Derive calendar stats from single query ──
    const todayEventsDetailed = calendarData.filter(
      (e) => e.startTime >= startOfToday && e.startTime < endOfToday
    );
    const eventsToday = todayEventsDetailed.length;
    const thisWeekFromToday = calendarData.filter(
      (e) => e.startTime >= startOfToday
    );
    const eventsThisWeek = thisWeekFromToday.length;
    const upcomingEvents = calendarData
      .filter((e) => e.startTime >= now)
      .slice(0, 5);
    const weekMeetings = calendarData.filter((e) => !e.isAllDay);

    // ── Derive task stats from single aggregate ──
    const ta = taskAggregates[0];
    const taskTotal = Number(ta?.total ?? 0);
    const taskCompleted = Number(ta?.completed ?? 0);
    const taskOverdue = Number(ta?.overdue ?? 0);
    const priorityMap: Record<string, number> = {
      LOW: Number(ta?.low ?? 0),
      MEDIUM: Number(ta?.medium ?? 0),
      HIGH: Number(ta?.high ?? 0),
      URGENT: Number(ta?.urgent ?? 0),
    };

    // Task status counts for donut chart (derive from task aggregates + separate groupBy)
    const taskStatusRaw = await prisma.task.groupBy({
      by: ['status'],
      where: { userId },
      _count: { status: true },
    });
    const taskStatusCounts: Record<string, number> = {};
    taskStatusRaw.forEach((s) => {
      taskStatusCounts[s.status] = s._count.status;
    });

    // ── Derive email stats from single aggregate ──
    const es = emailStats[0];
    const unreadCount = Number(es?.unread_count ?? 0);
    const unreadTodayCount = Number(es?.unread_today_count ?? 0);
    const totalSynced = Number(es?.total_synced ?? 0);

    // ── Derive customer stats ──
    const cc = customerCounts[0];
    const totalCustomers = Number(cc?.total_customers ?? 0);
    const totalContacts = Number(cc?.total_contacts ?? 0);

    // Meeting load: sum hours
    const meetingHoursThisWeek = weekMeetings.reduce((sum, e) => {
      return sum + (new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 3600000;
    }, 0);

    // ── Batch 2: Raw SQL aggregates (run in parallel) ──
    const [topCustomersRaw, emailVolumeResult, needsAttentionResult, frequentContactsResult] = await Promise.all([
      prisma.email.groupBy({
        by: ['customerId'],
        where: { userId, customerId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),

      // Email volume: last 14 days
      prisma.$queryRaw<Array<{ date: Date; sent: string; received: string }>>`
        SELECT
          DATE("received_at") as date,
          COUNT(*) FILTER (WHERE "from" LIKE '%' || ${userEmail} || '%') as sent,
          COUNT(*) FILTER (WHERE "from" NOT LIKE '%' || ${userEmail} || '%') as received
        FROM emails
        WHERE "received_at" >= ${fourteenDaysAgo} AND user_id = ${userId}
        GROUP BY DATE("received_at")
        ORDER BY date ASC
      `.catch(() => [] as Array<{ date: Date; sent: string; received: string }>),

      // Needs attention customers
      prisma.$queryRaw<Array<{
        id: string;
        name: string;
        domain: string | null;
        logoUrl: string | null;
        lastContactedDaysAgo: number | null;
        openTaskCount: string;
      }>>`
        SELECT
          c.id,
          c.name,
          c.domain,
          c.logo_url as "logoUrl",
          EXTRACT(DAY FROM NOW() - MAX(e.received_at))::int as "lastContactedDaysAgo",
          COUNT(DISTINCT t.id) FILTER (WHERE t.status != 'DONE')::int as "openTaskCount"
        FROM customers c
        LEFT JOIN emails e ON e.customer_id = c.id AND e.user_id = ${userId}
        LEFT JOIN tasks t ON t.customer_id = c.id AND t.user_id = ${userId}
        WHERE c.user_id = ${userId}
        GROUP BY c.id, c.name, c.domain, c.logo_url
        HAVING
          (MAX(e.received_at) < NOW() - INTERVAL '14 days' AND COUNT(DISTINCT t.id) FILTER (WHERE t.status != 'DONE') > 0)
          OR MAX(e.received_at) < NOW() - INTERVAL '30 days'
          OR MAX(e.received_at) IS NULL
        ORDER BY MAX(e.received_at) ASC NULLS FIRST
        LIMIT 5
      `.catch(() => []),

      // Frequent contacts
      prisma.$queryRaw<Array<{ email: string; name: string | null; messageCount: string }>>`
        SELECT
          "from" as email,
          "from_name" as name,
          COUNT(*)::int as "messageCount"
        FROM emails
        WHERE "from" NOT LIKE '%' || ${userEmail} || '%' AND user_id = ${userId}
        GROUP BY "from", "from_name"
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `.catch(() => []),
    ]);

    // ── Build email volume ──
    let emailVolume: Array<{ date: string; sent: number; received: number }> = [];
    const volumeMap = new Map<string, { sent: number; received: number }>();
    for (const row of emailVolumeResult) {
      const dateStr = formatDate(new Date(row.date));
      volumeMap.set(dateStr, { sent: Number(row.sent), received: Number(row.received) });
    }
    for (let i = 13; i >= 0; i--) {
      const d = subDays(startOfToday, i);
      const dateStr = formatDate(d);
      const existing = volumeMap.get(dateStr);
      emailVolume.push({ date: dateStr, sent: existing?.sent ?? 0, received: existing?.received ?? 0 });
    }

    // ── Build needs attention ──
    const needsAttention = needsAttentionResult.map((r) => ({
      ...r,
      lastContactedDaysAgo: r.lastContactedDaysAgo ?? 999,
      openTaskCount: Number(r.openTaskCount),
    }));

    // ── Batch 3: Post-processing lookups ──
    const customerIds = topCustomersRaw
      .map((r) => r.customerId)
      .filter((id): id is string => id !== null);

    const [customerDetails, taskCountsByCustomer, contactLookup] = await Promise.all([
      prisma.customer.findMany({
        where: { id: { in: customerIds }, userId },
        select: { id: true, name: true, domain: true, logoUrl: true },
      }),
      prisma.task.groupBy({
        by: ['customerId'],
        where: { userId, customerId: { in: customerIds } },
        _count: { id: true },
      }),
      // Enrich frequent contacts
      frequentContactsResult.length > 0
        ? prisma.contact.findMany({
            where: { customer: { userId }, email: { in: frequentContactsResult.map((f) => f.email) } },
            select: { id: true, email: true, customer: { select: { company: true } } },
          })
        : Promise.resolve([]),
    ]);

    // Top customers
    const customerMap = new Map(customerDetails.map((c) => [c.id, c]));
    const taskCountMap = new Map(taskCountsByCustomer.map((t) => [t.customerId, t._count.id]));

    const topCustomers = topCustomersRaw
      .map((r) => {
        const customer = customerMap.get(r.customerId!);
        if (!customer) return null;
        return {
          id: customer.id,
          name: customer.name,
          domain: customer.domain,
          logoUrl: customer.logoUrl,
          emailCount: r._count.id,
          taskCount: taskCountMap.get(customer.id) || 0,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    // Frequent contacts enrichment
    const contactMap = new Map(contactLookup.map((c) => [c.email, c]));
    const frequentContacts = frequentContactsResult.map((f) => {
      const contact = contactMap.get(f.email);
      return {
        email: f.email,
        name: f.name,
        company: contact?.customer?.company || null,
        contactId: contact?.id || null,
        messageCount: Number(f.messageCount),
      };
    });

    return {
      tasks: {
        total: taskTotal,
        completed: taskCompleted,
        overdue: taskOverdue,
        inProgress: taskTotal - taskCompleted,
        byPriority: priorityMap,
        recentTasks: recentTasks.map((t: any) => ({
          ...t,
          labels: t.labels?.map((tl: any) => tl.label) || [],
          customer: t.customer || null,
        })),
      },
      emails: {
        unreadCount,
        unreadTodayCount,
        totalSynced,
        recentUnread: recentUnreadEmails.map((e) => ({
          threadId: e.threadId,
          subject: e.subject,
          from: e.from,
          fromName: e.fromName,
          receivedAt: e.receivedAt,
          snippet: e.snippet,
        })),
      },
      calendar: {
        eventsToday,
        eventsThisWeek,
        upcomingEvents,
        meetingHoursThisWeek: Math.round(meetingHoursThisWeek * 10) / 10,
        meetingCountThisWeek: weekMeetings.length,
      },
      customers: {
        totalCustomers,
        totalContacts,
        topCustomers,
      },
      charts: {
        emailVolume,
        taskStatusCounts,
      },
      myDay: {
        events: todayEventsDetailed,
        tasksDueToday,
        unreadTodayCount,
      },
      needsAttention,
      frequentContacts,
    };
  },
};
