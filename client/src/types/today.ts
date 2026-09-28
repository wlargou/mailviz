import type { Task } from './task';
import type { ReplyOwed } from './email';

/** `GET /today` — the parts of the Today page. See server todayService. */

export interface TodayEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  location: string | null;
  conferenceLink: string | null;
  companies: Array<{ id: string; name: string }>;
  attendeeCount: number;
}

export type DeadlineKind = 'RFP_DEADLINE' | 'RFP_QUESTIONS' | 'PIECE_DUE' | 'TASK_DUE';

export interface TodayDeadline {
  kind: DeadlineKind;
  id: string;
  title: string;
  context: string | null;
  at: string;
  href: string;
}

export interface Pursuit {
  kind: 'RFP' | 'DEAL';
  id: string;
  title: string;
  reference: string | null;
  company: string | null;
  customerId: string | null;
  at: string;
  readiness: { ready: number; total: number } | null;
  atRisk: boolean;
  href: string;
}

export interface WaitingOn {
  threadId: string;
  subject: string;
  to: string;
  sentAt: string;
}

export interface QuietAccount {
  id: string;
  name: string;
  lastTouchAt: string | null;
  openWork: number;
}

export interface MeetingPrep {
  people: Array<{ email: string; name: string | null; responseStatus: string | null }>;
  recentThreads: Array<{ threadId: string | null; subject: string; from: string; receivedAt: string }>;
  openTasks: Array<{ id: string; title: string; dueDate: string | null; priority: Task['priority'] }>;
  tenders: Array<{ id: string; name: string; deadlineAt: string; status: string }>;
}

export interface Today {
  timezone: string;
  today: string;
  events: TodayEvent[];
  tasks: { overdue: Task[]; dueToday: Task[]; startingToday: Task[] };
  deadlines: TodayDeadline[];
  repliesOwed: ReplyOwed[];
  pursuits: Pursuit[];
  waitingOnOthers: WaitingOn[];
  quietAccounts: QuietAccount[];
  nextUp: { event: TodayEvent; prep: MeetingPrep } | null;
  wrapUp: {
    finished: Array<{ id: string; title: string }>;
    slipped: Array<{ id: string; title: string }>;
    tomorrow: Array<{ kind: 'EVENT' | DeadlineKind; id: string; title: string; at: string }>;
  };
}
