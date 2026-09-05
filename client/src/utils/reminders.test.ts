import { describe, it, expect } from 'vitest';
import { reminderFor, reminderPreset } from './reminders';

/**
 * Reminder presets are relative to the due date and always at nine, local.
 * Round-tripping matters: the instant a preset produces must read back as
 * that preset, and any other instant as null so the form shows it as is.
 */
const due = new Date(2026, 8, 10, 17, 0); // Thu 10 Sep 2026, 17:00 local

describe('reminders', () => {
  it('presets resolve to nine o\'clock on the right day', () => {
    expect(reminderFor('due-morning', due)).toEqual(new Date(2026, 8, 10, 9, 0));
    expect(reminderFor('day-before', due)).toEqual(new Date(2026, 8, 9, 9, 0));
    expect(reminderFor('week-before', due)).toEqual(new Date(2026, 8, 3, 9, 0));
    expect(reminderFor('none', due)).toBeNull();
    expect(reminderFor('day-before', null)).toBeNull();
  });

  it('a stored reminder reads back as its preset, or null when it is something else', () => {
    expect(reminderPreset(new Date(2026, 8, 9, 9, 0).toISOString(), due)).toBe('day-before');
    expect(reminderPreset(new Date(2026, 8, 3, 9, 0).toISOString(), due)).toBe('week-before');
    expect(reminderPreset(new Date(2026, 8, 9, 14, 30).toISOString(), due)).toBeNull();
    expect(reminderPreset(null, due)).toBe('none');
    // Without a due date nothing can match a preset.
    expect(reminderPreset(new Date(2026, 8, 9, 9, 0).toISOString(), null)).toBeNull();
  });

  it('crosses a month boundary the calendar way', () => {
    expect(reminderFor('week-before', new Date(2026, 9, 3, 12, 0))).toEqual(new Date(2026, 8, 26, 9, 0));
  });
});
