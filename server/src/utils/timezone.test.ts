import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  zoneOffsetMs,
  calendarDateInZone,
  formatDateInZone,
  startOfDayInZone,
  addDaysInZone,
  startOfWeekInZone,
  resolveTimeZone,
} from './timezone.js';

/**
 * Calendar-day arithmetic in a user's timezone.
 *
 * The cases that matter are the ones the server's own zone hid: a user east of
 * UTC whose day starts before the server's, a user west of UTC whose day starts
 * after, and the DST transitions where a "day" is not 24 hours and a "week" is
 * not 168. Those are exactly where `new Date(y, m, d)` and `+ 86400000` give
 * answers that look right in UTC and are wrong for the person reading them.
 *
 * Fixed instants throughout, never `new Date()` — a timezone test that depends
 * on when it runs will pass all year and fail one Sunday in March.
 */

afterEach(() => vi.useRealTimers());

const PARIS = 'Europe/Paris';
const LA = 'America/Los_Angeles';
const KIRITIMATI = 'Pacific/Kiritimati'; // UTC+14 — the far side of the date line

describe('zoneOffsetMs', () => {
  it('reads a positive offset east of UTC', () => {
    // 15 Jan 2026 — Paris on winter time, UTC+1.
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), PARIS)).toBe(3600000);
  });

  it('follows the zone across its own DST change', () => {
    // Paris moves to UTC+2 on 29 March 2026. Same zone, different offset —
    // which is the whole reason this cannot be a stored constant.
    expect(zoneOffsetMs(new Date('2026-07-15T12:00:00Z'), PARIS)).toBe(7200000);
  });

  it('reads a negative offset west of UTC', () => {
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), LA)).toBe(-8 * 3600000);
  });

  it('is zero for UTC', () => {
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), 'UTC')).toBe(0);
  });
});

describe('startOfDayInZone', () => {
  it('starts the day an hour before UTC does, east of UTC', () => {
    // 23:30 UTC on the 14th is already the 15th in Paris, and that day began
    // at 23:00 UTC on the 14th.
    const start = startOfDayInZone(new Date('2026-01-14T23:30:00Z'), PARIS);

    expect(start.toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });

  it('is still the previous day west of UTC', () => {
    // 02:00 UTC on the 15th is still the 14th in Los Angeles. This is the
    // window where a UTC "today" showed the wrong day's mail.
    const start = startOfDayInZone(new Date('2026-01-15T02:00:00Z'), LA);

    expect(start.toISOString()).toBe('2026-01-14T08:00:00.000Z');
  });

  it('handles a zone past the date line', () => {
    // UTC+14: it is already the 15th there while UTC is still on the 14th.
    const start = startOfDayInZone(new Date('2026-01-14T12:00:00Z'), KIRITIMATI);

    expect(formatDateInZone(start, KIRITIMATI)).toBe('2026-01-15');
  });

  it('lands on midnight the day DST springs forward', () => {
    // Paris jumps 02:00 → 03:00 on 29 March 2026. Midnight still exists, and
    // the day still starts at 23:00 UTC on the 28th.
    const start = startOfDayInZone(new Date('2026-03-29T12:00:00Z'), PARIS);

    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
  });
});

describe('addDaysInZone', () => {
  it('adds whole calendar days across a spring-forward', () => {
    // Paris jumps 02:00 → 03:00 ON 29 March, so it is the 29th that is 23
    // hours long — the step from the 29th to the 30th is the one that crosses
    // the transition. Stepping from the 28th does not, which is worth stating
    // because the first version of this test used the 28th, passed, and proved
    // nothing: naive millisecond arithmetic gives the same answer there.
    const next = addDaysInZone(new Date('2026-03-29T10:00:00Z'), 1, PARIS);

    // Midnight on the 30th is 22:00 UTC on the 29th — Paris is UTC+2 by then.
    // Adding 86400000 to midnight on the 29th would give 23:00, an hour late.
    expect(next.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(formatDateInZone(next, PARIS)).toBe('2026-03-30');
  });

  it('adds whole calendar days across a fall-back', () => {
    // Paris falls back 03:00 → 02:00 on 25 October, so the 25th is 25 hours
    // long and the step from the 25th to the 26th is the crossing one.
    const next = addDaysInZone(new Date('2026-10-25T10:00:00Z'), 1, PARIS);

    expect(next.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(formatDateInZone(next, PARIS)).toBe('2026-10-26');
  });

  it('keeps a seven-day span exactly seven calendar days', () => {
    const start = startOfDayInZone(new Date('2026-03-23T12:00:00Z'), PARIS);
    const end = addDaysInZone(start, 7, PARIS);

    // 167 hours, because the week contains a spring-forward — the point being
    // that the DATE is right even though the duration is not 168h.
    expect(formatDateInZone(end, PARIS)).toBe('2026-03-30');
    expect(end.getTime() - start.getTime()).toBe(167 * 3600000);
  });

  it('goes backwards too', () => {
    const back = addDaysInZone(new Date('2026-01-15T12:00:00Z'), -3, PARIS);

    expect(formatDateInZone(back, PARIS)).toBe('2026-01-12');
  });
});

describe('startOfWeekInZone', () => {
  it('returns Monday for a midweek day', () => {
    // Thursday 15 January 2026 → Monday the 12th.
    const start = startOfWeekInZone(new Date('2026-01-15T12:00:00Z'), PARIS);

    expect(formatDateInZone(start, PARIS)).toBe('2026-01-12');
  });

  it('treats Sunday as the END of the week, not the start', () => {
    // The bug this guards is the reason "meeting hours this week" could span
    // 13 days: Sunday belongs to the week that began six days ago.
    const sunday = new Date('2026-01-18T12:00:00Z');
    const start = startOfWeekInZone(sunday, PARIS);

    expect(formatDateInZone(start, PARIS)).toBe('2026-01-12');
  });

  it('returns the same day when it is already Monday', () => {
    const start = startOfWeekInZone(new Date('2026-01-12T12:00:00Z'), PARIS);

    expect(formatDateInZone(start, PARIS)).toBe('2026-01-12');
  });

  it('uses the weekday in the ZONE, not in UTC', () => {
    // 22:00 UTC on Sunday the 18th is already Monday the 19th in Paris, so the
    // week has rolled over there while UTC still says Sunday.
    const start = startOfWeekInZone(new Date('2026-01-18T23:30:00Z'), PARIS);

    expect(formatDateInZone(start, PARIS)).toBe('2026-01-19');
  });
});

describe('resolveTimeZone', () => {
  it('accepts a valid IANA zone', () => {
    expect(resolveTimeZone(PARIS)).toBe(PARIS);
  });

  it('falls back to UTC for null, which is every account before this shipped', () => {
    expect(resolveTimeZone(null)).toBe('UTC');
    expect(resolveTimeZone(undefined)).toBe('UTC');
    expect(resolveTimeZone('')).toBe('UTC');
  });

  it('falls back rather than throwing on a malformed zone', () => {
    // The column is free text from a client. A bad value must not turn one
    // user's dashboard into a 500.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(resolveTimeZone('Not/AZone')).toBe('UTC');
    expect(resolveTimeZone('"; DROP TABLE users; --')).toBe('UTC');
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
