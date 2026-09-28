import type { Today } from '../types/today';
import type { Task } from '../types/task';

/**
 * Today's timeline: the dated things of the day in time order, and the
 * undated ones — late tasks, tasks due "today" with no hour — gathered first,
 * because they are already due.
 *
 * The shapes carry the type as well as colour (Carbon's status-indicator
 * pattern): meeting ●, deadline ▲, task ■.
 */
export type TimelineItem =
  | { kind: 'meeting'; id: string; at: Date; end: Date; title: string; context: string | null; href: string; past: boolean; link: string | null }
  | { kind: 'deadline'; id: string; at: Date; title: string; context: string | null; href: string; past: boolean; label: string }
  | { kind: 'task'; id: string; at: Date | null; title: string; context: string | null; task: Task; late: boolean; past: boolean; starts?: boolean };

const DEADLINE_LABEL: Record<string, string> = {
  RFP_DEADLINE: 'Tender due',
  RFP_QUESTIONS: 'Questions close',
  PIECE_DUE: 'Piece due',
};

/** A due date with no hour — stored as local midnight — is "any time today". */
function hasTime(d: Date): boolean {
  return !(d.getHours() === 0 && d.getMinutes() === 0);
}

export function buildTimeline(today: Today, now = new Date()): { anytime: TimelineItem[]; timed: TimelineItem[] } {
  const anytime: TimelineItem[] = [];
  const timed: TimelineItem[] = [];

  for (const t of today.tasks.overdue) {
    anytime.push({ kind: 'task', id: t.id, at: null, title: t.title, context: t.customer?.name ?? null, task: t, late: true, past: false });
  }
  for (const t of today.tasks.dueToday) {
    const at = t.dueDate ? new Date(t.dueDate) : null;
    const item: TimelineItem = { kind: 'task', id: t.id, at, title: t.title, context: t.customer?.name ?? null, task: t, late: false, past: false };
    if (at && hasTime(at)) timed.push({ ...item, late: at < now, past: false });
    else anytime.push(item);
  }
  // Work that can begin today, and is not already listed as due.
  const listed = new Set([...today.tasks.overdue, ...today.tasks.dueToday].map((t) => t.id));
  for (const t of today.tasks.startingToday) {
    if (listed.has(t.id)) continue;
    anytime.push({ kind: 'task', id: t.id, at: null, title: t.title, context: t.customer?.name ?? null, task: t, late: false, past: false, starts: true });
  }
  for (const e of today.events) {
    if (e.isAllDay) continue;
    const at = new Date(e.startTime);
    const end = new Date(e.endTime);
    timed.push({
      kind: 'meeting', id: e.id, at, end, title: e.title,
      context: e.companies.map((c) => c.name).join(', ') || null,
      href: `/calendar?event=${e.id}`, past: end <= now, link: e.conferenceLink,
    });
  }
  for (const d of today.deadlines) {
    const at = new Date(d.at);
    timed.push({
      kind: 'deadline', id: `${d.kind}:${d.id}`, at, title: d.title, context: d.context,
      href: d.href, past: at <= now, label: DEADLINE_LABEL[d.kind] ?? 'Due',
    });
  }
  timed.sort((a, b) => (a.at as Date).getTime() - (b.at as Date).getTime());
  return { anytime, timed };
}

/** "1 tender at risk · 4 tasks late · 3 meetings · 2 replies owed" — the parts that are not zero, and how much is due. */
export function todaySummary(today: Today, now = new Date()): { count: number; parts: string[] } {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const atRisk = today.pursuits.filter((p) => p.atRisk).length;
  const late = today.tasks.overdue.length;
  const meetings = today.events.filter((e) => !e.isAllDay && new Date(e.endTime) > now).length;
  const owed = today.repliesOwed.length;
  const due = today.tasks.dueToday.length;
  const parts = [
    atRisk && plural(atRisk, 'tender at risk', 'tenders at risk'),
    late && plural(late, 'task late', 'tasks late'),
    due && plural(due, 'task due', 'tasks due'),
    meetings && plural(meetings, 'meeting', 'meetings'),
    owed && plural(owed, 'reply owed', 'replies owed'),
  ].filter(Boolean) as string[];
  // The count is the work that is due — at risk, late, due today. Meetings
  // and replies are named but not counted: 71 replies owed made "83 things
  // need you", a number nobody acts on.
  return { count: atRisk + late + due, parts };
}

/** After the working day the page closes it out: the wrap-up leads. */
export const WRAP_UP_HOUR = 17;
