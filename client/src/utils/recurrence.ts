import { format } from 'date-fns';

/**
 * Recurrence presets, shared by calendar events and tasks.
 *
 * A fixed set rather than a full RRULE builder. Anything outside these
 * presets is shown read-only so an existing rule is never silently rewritten
 * into something simpler than what the user set elsewhere (an event edited in
 * Google Calendar, say). Every preset is anchored on a date — the event's
 * start, the task's due date — because "weekly" means "weekly on that day".
 */
export type RecurrencePresetId = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceOption {
  id: RecurrencePresetId;
  label: string;
}

export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/** Build the RFC 5545 lines for a preset, anchored on `start`. */
export function buildRecurrenceRules(presetId: RecurrencePresetId, start: Date): string[] {
  switch (presetId) {
    case 'daily':
      return ['RRULE:FREQ=DAILY'];
    case 'weekly':
      return [`RRULE:FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES[start.getDay()]}`];
    case 'monthly':
      return [`RRULE:FREQ=MONTHLY;BYMONTHDAY=${start.getDate()}`];
    case 'yearly':
      return ['RRULE:FREQ=YEARLY'];
    case 'none':
    default:
      return [];
  }
}

export function buildRecurrenceOptions(start: Date): RecurrenceOption[] {
  return [
    { id: 'none', label: 'Does not repeat' },
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: `Weekly on ${format(start, 'EEEE')}` },
    { id: 'monthly', label: `Monthly on day ${start.getDate()}` },
    { id: 'yearly', label: `Yearly on ${format(start, 'MMMM d')}` },
  ];
}

/**
 * Map an existing recurrence back onto a preset, or null when the rule is
 * richer than our presets (INTERVAL, COUNT, UNTIL, multiple BYDAYs, EXDATEs…).
 */
export function parseRecurrencePreset(rules: string[], start: Date): RecurrencePresetId | null {
  if (rules.length === 0) return 'none';
  if (rules.length > 1) return null;

  const rule = rules[0].trim().toUpperCase();
  if (!rule.startsWith('RRULE:')) return null;

  const params = new Map<string, string>();
  for (const part of rule.slice('RRULE:'.length).split(';')) {
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx <= 0) return null;
    params.set(part.slice(0, idx), part.slice(idx + 1));
  }

  const freq = params.get('FREQ');
  if (!freq) return null;

  // Only the qualifier our own presets emit is representable.
  const qualifier = freq === 'WEEKLY' ? 'BYDAY' : freq === 'MONTHLY' ? 'BYMONTHDAY' : null;
  for (const key of params.keys()) {
    if (key !== 'FREQ' && key !== qualifier) return null;
  }

  switch (freq) {
    case 'DAILY':
      return 'daily';
    case 'WEEKLY': {
      const byDay = params.get('BYDAY');
      return !byDay || byDay === WEEKDAY_CODES[start.getDay()] ? 'weekly' : null;
    }
    case 'MONTHLY': {
      const byMonthDay = params.get('BYMONTHDAY');
      return !byMonthDay || byMonthDay === String(start.getDate()) ? 'monthly' : null;
    }
    case 'YEARLY':
      return 'yearly';
    default:
      return null;
  }
}

/**
 * A rule as a person reads it — for a row or a tooltip, where the presets'
 * option labels would need the anchor date to hand.
 */
export function describeRecurrence(rule: string | null | undefined): string | null {
  if (!rule) return null;
  const m = /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;INTERVAL=(\d+))?(?:;BYDAY=(\w\w))?(?:;BYMONTHDAY=(\d+))?$/i.exec(rule.trim());
  if (!m) return 'Repeats';
  const [, freq, interval, byDay, byMonthDay] = m;
  const n = interval ? Number(interval) : 1;
  const every = (unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
  const dayName = byDay ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][WEEKDAY_CODES.indexOf(byDay.toUpperCase() as (typeof WEEKDAY_CODES)[number])] : null;
  switch (freq.toUpperCase()) {
    case 'DAILY':
      return n === 1 ? 'Daily' : every('day');
    case 'WEEKLY':
      return `${n === 1 ? 'Weekly' : every('week')}${dayName ? ` on ${dayName}` : ''}`;
    case 'MONTHLY':
      return `${n === 1 ? 'Monthly' : every('month')}${byMonthDay ? ` on day ${byMonthDay}` : ''}`;
    case 'YEARLY':
      return n === 1 ? 'Yearly' : every('year');
    default:
      return 'Repeats';
  }
}
