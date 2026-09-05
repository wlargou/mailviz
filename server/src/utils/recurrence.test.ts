import { describe, it, expect } from 'vitest';
import { nextOccurrence, parseRule, TASK_RRULE_PATTERN } from './recurrence.js';

/**
 * Stepping a due date along a rule.
 *
 * The cases that matter are the ones a naive "add seven days" gets wrong: a
 * task finished weeks late must land in the future, a weekly rule keeps its
 * weekday when the due date drifted, and "monthly on the 31st" survives
 * February and comes back to the 31st afterwards.
 */
const d = (iso: string) => new Date(iso);

describe('parseRule', () => {
  it('accepts what the presets emit, plus an interval', () => {
    expect(parseRule('RRULE:FREQ=WEEKLY;BYDAY=MO')).toEqual({ freq: 'WEEKLY', interval: 1, byDay: 1, byMonthDay: null });
    expect(parseRule('RRULE:FREQ=MONTHLY;BYMONTHDAY=15')).toEqual({ freq: 'MONTHLY', interval: 1, byDay: null, byMonthDay: 15 });
    expect(parseRule('RRULE:FREQ=DAILY;INTERVAL=3')).toEqual({ freq: 'DAILY', interval: 3, byDay: null, byMonthDay: null });
    expect(parseRule('RRULE:FREQ=YEARLY')).toEqual({ freq: 'YEARLY', interval: 1, byDay: null, byMonthDay: null });
  });

  it('rejects what it cannot advance', () => {
    for (const bad of [
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', // several days
      'RRULE:FREQ=WEEKLY;COUNT=3',
      'RRULE:FREQ=DAILY;UNTIL=20261231',
      'RRULE:FREQ=HOURLY',
      'RRULE:FREQ=DAILY;BYDAY=MO', // qualifier on the wrong frequency
      'RRULE:FREQ=WEEKLY;BYMONTHDAY=3',
      'FREQ=WEEKLY',
      'RRULE:FREQ=MONTHLY;BYMONTHDAY=32',
    ]) {
      expect(parseRule(bad), bad).toBeNull();
      expect(TASK_RRULE_PATTERN.test(bad) && parseRule(bad) !== null, bad).toBe(false);
    }
  });
});

describe('nextOccurrence', () => {
  it('daily: the day after the due date when finished on time', () => {
    expect(nextOccurrence('RRULE:FREQ=DAILY', d('2026-09-07T09:00:00'), d('2026-09-07T10:00:00'))).toEqual(d('2026-09-08T09:00:00'));
  });

  it('finished late: skips the missed occurrences and lands after now, keeping the cadence', () => {
    // Weekly on Monday, due Mon 2026-08-17, finished Thu 2026-09-10 → Mon 2026-09-14, not 08-24.
    expect(nextOccurrence('RRULE:FREQ=WEEKLY;BYDAY=MO', d('2026-08-17T09:00:00'), d('2026-09-10T12:00:00'))).toEqual(d('2026-09-14T09:00:00'));
  });

  it('weekly keeps the rule\'s weekday even when the due date drifted off it', () => {
    // Rule says Monday; the due date was edited to Wednesday 2026-09-09.
    expect(nextOccurrence('RRULE:FREQ=WEEKLY;BYDAY=MO', d('2026-09-09T09:00:00'), d('2026-09-09T10:00:00'))).toEqual(d('2026-09-14T09:00:00'));
  });

  it('every two weeks steps by fourteen days', () => {
    expect(nextOccurrence('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', d('2026-09-04T09:00:00'), d('2026-09-04T10:00:00'))).toEqual(d('2026-09-18T09:00:00'));
  });

  it('monthly on the 31st clamps to short months and comes back', () => {
    const rule = 'RRULE:FREQ=MONTHLY;BYMONTHDAY=31';
    const jan = d('2026-01-31T09:00:00');
    const feb = nextOccurrence(rule, jan, jan)!;
    expect(feb).toEqual(d('2026-02-28T09:00:00'));
    const mar = nextOccurrence(rule, feb, feb)!;
    expect(mar).toEqual(d('2026-03-31T09:00:00'));
    const apr = nextOccurrence(rule, mar, mar)!;
    expect(apr).toEqual(d('2026-04-30T09:00:00'));
  });

  it('yearly on Feb 29 lands on Feb 28 in a common year', () => {
    expect(nextOccurrence('RRULE:FREQ=YEARLY', d('2028-02-29T09:00:00'), d('2028-02-29T10:00:00'))).toEqual(d('2029-02-28T09:00:00'));
  });

  it('returns null for a rule it cannot parse', () => {
    expect(nextOccurrence('RRULE:FREQ=WEEKLY;COUNT=2', d('2026-09-07'), d('2026-09-07'))).toBeNull();
  });
});
