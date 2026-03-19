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
  async getStats() {
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
    const authRecord = await prisma.googleAuth.findFirst({ select: { email: true } });
    const userEmail = authRecord?.email ?? '';

    const [
      // Tasks
      taskTotal,
      taskCompleted,
      taskOverdue,
      taskByPriority,
      recentTasks,
      taskStatusRaw,
      tasksDueToday,
      // Emails
      unreadCount,
      unreadTodayCount,
      totalSynced,
      recentUnreadEmails,
      // Calendar
      eventsToday,
      eventsThisWeek,
      upcomingEvents,
      todayEventsDetailed,
      weekMeetings,
      // Customers
      totalCustomers,
      totalContacts,
      topCustomersRaw,
    ] = await Promise.all([
      // Tasks
      prisma.task.count(),
      prisma.task.count({ where: { status: 'DONE' } }),
      prisma.task.count({
        where: { status: { not: 'DONE' }, dueDate: { lt: now } },
      }),
      prisma.task.groupBy({
        by: ['priority'],
        _count: { priority: true },
      }),
      prisma.task.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          labels: { include: { label: true } },
          customer: { select: { id: true, name: true, company: true } },
        },
      }),
      // Task status counts for donut chart
      prisma.task.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      // Tasks due today
      prisma.task.findMany({
        where: {
          status: { not: 'DONE' },
          dueDate: { gte: startOfToday, lt: endOfToday },
        },
        orderBy: { dueDate: 'asc' },
        select: { id: true, title: true, priority: true, status: true, dueDate: true },
      }),
      // Emails
      prisma.email.count({ where: { isRead: false } }),
      prisma.email.count({ where: { isRead: false, receivedAt: { gte: startOfToday } } }),
      prisma.email.count(),
      prisma.email.findMany({
        where: { isRead: false },
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
      // Calendar
      prisma.calendarEvent.count({
        where: { startTime: { gte: startOfToday, lt: endOfToday } },
      }),
      prisma.calendarEvent.count({
        where: { startTime: { gte: startOfToday, lt: endOfWeek } },
      }),
      prisma.calendarEvent.findMany({
        where: { startTime: { gte: now } },
        orderBy: { startTime: 'asc' },
        take: 5,
        select: {
          id: true,
          title: true,
          startTime: true,
          endTime: true,
          isAllDay: true,
          location: true,
        },
      }),
      // Today's events (detailed for My Day)
      prisma.calendarEvent.findMany({
        where: { startTime: { gte: startOfToday, lt: endOfToday } },
        orderBy: { startTime: 'asc' },
        select: {
          id: true,
          title: true,
          startTime: true,
          endTime: true,
          isAllDay: true,
          location: true,
        },
      }),
      // Meeting load this week (non-all-day)
      prisma.calendarEvent.findMany({
        where: {
          startTime: { gte: startOfWeek, lt: endOfWeek },
          isAllDay: false,
        },
        select: { startTime: true, endTime: true },
      }),
      // Customers
      prisma.customer.count(),
      prisma.contact.count(),
      prisma.email.groupBy({
        by: ['customerId'],
        where: { customerId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
    ]);

    // ── Post-processing ──

    // Resolve top customer details
    const customerIds = topCustomersRaw
      .map((r) => r.customerId)
      .filter((id): id is string => id !== null);

    const [customerDetails, taskCounts] = await Promise.all([
      prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, name: true, domain: true, logoUrl: true },
      }),
      prisma.task.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds } },
        _count: { id: true },
      }),
    ]);

    const customerMap = new Map(customerDetails.map((c) => [c.id, c]));
    const taskCountMap = new Map(taskCounts.map((t) => [t.customerId, t._count.id]));

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

    // Build priority map
    const priorityMap: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };
    taskByPriority.forEach((p) => {
      priorityMap[p.priority] = p._count.priority;
    });

    // Build task status counts for donut
    const taskStatusCounts: Record<string, number> = { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
    taskStatusRaw.forEach((s) => {
      taskStatusCounts[s.status] = s._count.status;
    });

    // Meeting load: sum hours
    const meetingHoursThisWeek = weekMeetings.reduce((sum, e) => {
      return sum + (new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 3600000;
    }, 0);

    // Email volume: last 14 days using Prisma query
    let emailVolume: Array<{ date: string; sent: number; received: number }> = [];
    try {
      const emailVolumeRaw: Array<{ date: Date; sent: string; received: string }> = await prisma.$queryRaw`
        SELECT
          DATE("received_at") as date,
          COUNT(*) FILTER (WHERE "from" LIKE '%' || ${userEmail} || '%') as sent,
          COUNT(*) FILTER (WHERE "from" NOT LIKE '%' || ${userEmail} || '%') as received
        FROM emails
        WHERE "received_at" >= ${fourteenDaysAgo}
        GROUP BY DATE("received_at")
        ORDER BY date ASC
      `;

      // Build a map from raw results
      const volumeMap = new Map<string, { sent: number; received: number }>();
      for (const row of emailVolumeRaw) {
        const dateStr = formatDate(new Date(row.date));
        volumeMap.set(dateStr, { sent: Number(row.sent), received: Number(row.received) });
      }

      // Fill 14 days
      for (let i = 13; i >= 0; i--) {
        const d = subDays(startOfToday, i);
        const dateStr = formatDate(d);
        const existing = volumeMap.get(dateStr);
        emailVolume.push({ date: dateStr, sent: existing?.sent ?? 0, received: existing?.received ?? 0 });
      }
    } catch (err) {
      // Fallback: 14 zero entries if raw SQL fails
      for (let i = 13; i >= 0; i--) {
        emailVolume.push({ date: formatDate(subDays(startOfToday, i)), sent: 0, received: 0 });
      }
    }

    // Needs Attention customers
    let needsAttention: Array<{
      id: string;
      name: string;
      domain: string | null;
      logoUrl: string | null;
      lastContactedDaysAgo: number;
      openTaskCount: number;
    }> = [];
    try {
      const needsAttentionRaw: Array<{
        id: string;
        name: string;
        domain: string | null;
        logoUrl: string | null;
        lastContactedDaysAgo: number | null;
        openTaskCount: string;
      }> = await prisma.$queryRaw`
        SELECT
          c.id,
          c.name,
          c.domain,
          c.logo_url as "logoUrl",
          EXTRACT(DAY FROM NOW() - MAX(e.received_at))::int as "lastContactedDaysAgo",
          COUNT(DISTINCT t.id) FILTER (WHERE t.status != 'DONE')::int as "openTaskCount"
        FROM customers c
        LEFT JOIN emails e ON e.customer_id = c.id
        LEFT JOIN tasks t ON t.customer_id = c.id
        GROUP BY c.id, c.name, c.domain, c.logo_url
        HAVING
          (MAX(e.received_at) < NOW() - INTERVAL '14 days' AND COUNT(DISTINCT t.id) FILTER (WHERE t.status != 'DONE') > 0)
          OR MAX(e.received_at) < NOW() - INTERVAL '30 days'
          OR MAX(e.received_at) IS NULL
        ORDER BY MAX(e.received_at) ASC NULLS FIRST
        LIMIT 5
      `;
      needsAttention = needsAttentionRaw.map((r) => ({
        ...r,
        lastContactedDaysAgo: r.lastContactedDaysAgo ?? 999,
        openTaskCount: Number(r.openTaskCount),
      }));
    } catch {
      // Fallback: empty
    }

    // Frequent contacts
    let frequentContacts: Array<{
      email: string;
      name: string | null;
      company: string | null;
      contactId: string | null;
      messageCount: number;
    }> = [];
    try {
      const frequentRaw: Array<{ email: string; name: string | null; messageCount: string }> = await prisma.$queryRaw`
        SELECT
          "from" as email,
          "from_name" as name,
          COUNT(*)::int as "messageCount"
        FROM emails
        WHERE "from" NOT LIKE '%' || ${userEmail} || '%'
        GROUP BY "from", "from_name"
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `;

      // Enrich with contact info
      const contactEmails = frequentRaw.map((f) => f.email);
      const contactLookup = await prisma.contact.findMany({
        where: { email: { in: contactEmails } },
        select: { id: true, email: true, customer: { select: { company: true } } },
      });
      const contactMap = new Map(contactLookup.map((c) => [c.email, c]));

      frequentContacts = frequentRaw.map((f) => {
        const contact = contactMap.get(f.email);
        return {
          email: f.email,
          name: f.name,
          company: contact?.customer?.company || null,
          contactId: contact?.id || null,
          messageCount: Number(f.messageCount),
        };
      });
    } catch {
      // Fallback: empty
    }

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
