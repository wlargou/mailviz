import type { Task } from './task';

export interface DashboardStats {
  tasks: {
    total: number;
    completed: number;
    overdue: number;
    inProgress: number;
    byPriority: Record<string, number>;
    recentTasks: Task[];
  };
  emails: {
    unreadCount: number;
    unreadTodayCount: number;
    totalSynced: number;
    recentEmails: Array<{
      threadId: string | null;
      subject: string;
      from: string;
      fromName: string | null;
      receivedAt: string;
      snippet: string | null;
      isRead: boolean;
    }>;
  };
  calendar: {
    eventsToday: number;
    eventsThisWeek: number;
    meetingHoursThisWeek: number;
    meetingCountThisWeek: number;
    upcomingEvents: Array<{
      id: string;
      title: string;
      startTime: string;
      endTime: string;
      isAllDay: boolean;
      location: string | null;
      conferenceLink: string | null;
    }>;
  };
  customers: {
    totalCustomers: number;
    totalContacts: number;
    topCustomers: Array<{
      id: string;
      name: string;
      domain: string | null;
      logoUrl: string | null;
      emailCount: number;
      taskCount: number;
    }>;
  };
  charts: {
    emailVolume: Array<{ date: string; sent: number; received: number }>;
    taskStatusCounts: Record<string, number>;
  };
  myDay: {
    events: Array<{
      id: string;
      title: string;
      startTime: string;
      endTime: string;
      isAllDay: boolean;
      location: string | null;
      conferenceLink: string | null;
    }>;
    tasksDueToday: Array<{
      id: string;
      title: string;
      priority: string;
      status: string;
      dueDate: string;
    }>;
    unreadTodayCount: number;
  };
  needsAttention: Array<{
    id: string;
    name: string;
    domain: string | null;
    logoUrl: string | null;
    lastContactedDaysAgo: number;
    openTaskCount: number;
  }>;
  frequentContacts: Array<{
    email: string;
    name: string | null;
    company: string | null;
    contactId: string | null;
    messageCount: number;
  }>;
  expiringDeals: Array<{
    id: string;
    title: string;
    status: string;
    expiryDate: string;
    partner: { name: string };
    customer: { id: string; name: string } | null;
    daysUntilExpiry: number;
  }>;
}
