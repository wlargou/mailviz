/**
 * The recurrence rules a task may carry, and how to step a due date along one.
 *
 * Deliberately a subset of RFC 5545: FREQ with an optional INTERVAL, a single
 * BYDAY for weekly rules and a BYMONTHDAY for monthly ones. It is exactly what
 * the shared client presets emit (plus INTERVAL, which costs nothing here), so
 * anything the validator accepts, `nextOccurrence` can advance. A richer rule
 * belongs to Google Calendar events, which hand it to Google and never have to
 * compute a date from it.
 */

/** What the validator admits. Case-sensitive on purpose: it is what we emit. */
export const TASK_RRULE_PATTERN =
  /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;INTERVAL=([1-9]\d{0,2}))?(?:;BYDAY=(MO|TU|WE|TH|FR|SA|SU))?(?:;BYMONTHDAY=([1-9]|[12]\d|3[01]))?$/;

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface ParsedRule {
  freq: Frequency;
  interval: number;
  /** 0 = Sunday … 6 = Saturday, as `Date#getDay()` numbers them. */
  byDay: number | null;
  byMonthDay: number | null;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function parseRule(rule: string): ParsedRule | null {
  const m = TASK_RRULE_PATTERN.exec(rule.trim());
  if (!m) return null;
  const [, freq, interval, byDay, byMonthDay] = m;
  // A BYDAY only means something weekly, a BYMONTHDAY only monthly.
  if (byDay && freq !== 'WEEKLY') return null;
  if (byMonthDay && freq !== 'MONTHLY') return null;
  return {
    freq: freq as Frequency,
    interval: interval ? Number(interval) : 1,
    byDay: byDay ? WEEKDAYS.indexOf(byDay) : null,
    byMonthDay: byMonthDay ? Number(byMonthDay) : null,
  };
}

/**
 * The first occurrence strictly after `after`, stepping from `from`.
 *
 * `from` is the finished occurrence's due date; `after` is normally now. The
 * two are separate because a task finished late must not be rescheduled into
 * the past: a weekly task due three Mondays ago and finished today gets next
 * Monday, not the two Mondays in between. Stepping from `from` (rather than
 * from `after`) keeps the cadence on its original weekday or day of month.
 * Time of day is carried over from `from`.
 */
export function nextOccurrence(rule: string, from: Date, after: Date = new Date()): Date | null {
  const parsed = parseRule(rule);
  if (!parsed) return null;

  // Anchor the cadence on the rule's own qualifier when the due date drifted
  // off it (a weekly-on-Monday task whose due date was edited to a Tuesday).
  let cursor = alignToRule(from, parsed);
  // Bounded: 5,000 daily steps is ~14 years past a stale due date.
  for (let i = 0; i < 5000; i++) {
    cursor = step(cursor, parsed);
    if (cursor.getTime() > after.getTime()) return cursor;
  }
  return null;
}

function alignToRule(from: Date, rule: ParsedRule): Date {
  const d = new Date(from.getTime());
  if (rule.freq === 'WEEKLY' && rule.byDay !== null && d.getDay() !== rule.byDay) {
    // Back to the most recent matching weekday, so the first step lands on the next one.
    const back = (d.getDay() - rule.byDay + 7) % 7;
    d.setDate(d.getDate() - back);
  }
  if (rule.freq === 'MONTHLY' && rule.byMonthDay !== null) {
    d.setDate(Math.min(rule.byMonthDay, daysInMonth(d)));
  }
  return d;
}

function step(d: Date, rule: ParsedRule): Date {
  const n = new Date(d.getTime());
  switch (rule.freq) {
    case 'DAILY':
      n.setDate(n.getDate() + rule.interval);
      return n;
    case 'WEEKLY':
      n.setDate(n.getDate() + 7 * rule.interval);
      return n;
    case 'MONTHLY': {
      // Land on the same day of month, clamped: "monthly on the 31st" is the
      // 30th in April and the 28th/29th in February, and then back to the 31st.
      const day = rule.byMonthDay ?? d.getDate();
      n.setDate(1);
      n.setMonth(n.getMonth() + rule.interval);
      n.setDate(Math.min(day, daysInMonth(n)));
      return n;
    }
    case 'YEARLY': {
      const month = d.getMonth();
      const day = d.getDate();
      n.setDate(1);
      n.setFullYear(n.getFullYear() + rule.interval);
      n.setMonth(month);
      n.setDate(Math.min(day, daysInMonth(n)));
      return n;
    }
  }
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
