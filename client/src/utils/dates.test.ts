import { describe, it, expect } from 'vitest';
import { shortDate, timeLeft } from './dates';

const now = new Date(2026, 8, 28, 9, 0); // Mon 28 Sep 2026, 09:00 local

describe('shortDate', () => {
  it("drops the year when it is this year's", () => {
    expect(shortDate(new Date(2026, 8, 27), { now })).toBe('Sep 27');
    expect(shortDate(new Date(2026, 8, 30), { now, dayFirst: true })).toBe('30 Sep');
  });

  it("keeps it when it is another year's", () => {
    expect(shortDate(new Date(2025, 11, 31), { now })).toBe('Dec 31, 2025');
    expect(shortDate(new Date(2027, 0, 2), { now, dayFirst: true })).toBe('2 Jan 2027');
  });
});

describe('timeLeft', () => {
  it('counts calendar days ahead', () => {
    expect(timeLeft(new Date(2026, 8, 30, 11, 0), now)).toBe('in 2 days');
    // Less than 48 hours away, and still two days out on the calendar.
    expect(timeLeft(new Date(2026, 8, 30, 8, 0), now)).toBe('in 2 days');
    expect(timeLeft(new Date(2026, 8, 29, 23, 0), now)).toBe('tomorrow');
  });

  it('counts hours within today', () => {
    expect(timeLeft(new Date(2026, 8, 28, 14, 0), now)).toBe('in 5 hours');
    expect(timeLeft(new Date(2026, 8, 28, 9, 20), now)).toBe('in 20 minutes');
  });

  it('says how late a passed deadline is', () => {
    expect(timeLeft(new Date(2026, 8, 25, 9, 0), now)).toBe('3 days late');
    expect(timeLeft(new Date(2026, 8, 28, 6, 0), now)).toBe('3 hours late');
  });
});
