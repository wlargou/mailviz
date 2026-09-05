import { describe, it, expect } from 'vitest';
import { buildRecurrenceOptions, buildRecurrenceRules, describeRecurrence, parseRecurrencePreset } from './recurrence';

/**
 * The presets shared by events and tasks.
 *
 * Round-tripping matters: what a preset emits must parse back to the same
 * preset against the same anchor, and to null against a different weekday —
 * that null is what keeps the form from flattening a rule set elsewhere.
 */
const monday = new Date(2026, 8, 7, 9, 0); // Mon 7 Sep 2026

describe('recurrence presets', () => {
  it('emit rules anchored on the date and parse back to themselves', () => {
    for (const option of buildRecurrenceOptions(monday)) {
      const rules = buildRecurrenceRules(option.id, monday);
      expect(parseRecurrencePreset(rules, monday), option.id).toBe(option.id);
    }
    expect(buildRecurrenceRules('weekly', monday)).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO']);
    expect(buildRecurrenceRules('monthly', monday)).toEqual(['RRULE:FREQ=MONTHLY;BYMONTHDAY=7']);
  });

  it('labels name the anchor', () => {
    const labels = buildRecurrenceOptions(monday).map((o) => o.label);
    expect(labels).toEqual(['Does not repeat', 'Daily', 'Weekly on Monday', 'Monthly on day 7', 'Yearly on September 7']);
  });

  it('a rule that does not fit a preset, or fits a different anchor, is null', () => {
    const tuesday = new Date(2026, 8, 8);
    expect(parseRecurrencePreset(['RRULE:FREQ=WEEKLY;BYDAY=MO'], tuesday)).toBeNull();
    expect(parseRecurrencePreset(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'], monday)).toBeNull();
    expect(parseRecurrencePreset(['RRULE:FREQ=DAILY;COUNT=3'], monday)).toBeNull();
    expect(parseRecurrencePreset([], monday)).toBe('none');
  });
});

describe('describeRecurrence', () => {
  it('reads a rule as a person would', () => {
    expect(describeRecurrence('RRULE:FREQ=WEEKLY;BYDAY=MO')).toBe('Weekly on Monday');
    expect(describeRecurrence('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR')).toBe('Every 2 weeks on Friday');
    expect(describeRecurrence('RRULE:FREQ=MONTHLY;BYMONTHDAY=15')).toBe('Monthly on day 15');
    expect(describeRecurrence('RRULE:FREQ=DAILY')).toBe('Daily');
    expect(describeRecurrence('RRULE:FREQ=YEARLY')).toBe('Yearly');
    expect(describeRecurrence(null)).toBeNull();
    expect(describeRecurrence('RRULE:FREQ=WEEKLY;COUNT=3')).toBe('Repeats');
  });
});
