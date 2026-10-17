import { describe, it, expect } from 'vitest';
import { amountHtOf, effectiveDateOf, endOfPeriod, formatPartialDate, parsePartialDate } from './clientReference.js';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('partial dates', () => {
  it('keeps the precision the letter gave', () => {
    expect(parsePartialDate('2025')).toEqual({ date: day('2025-01-01'), precision: 'YEAR' });
    expect(parsePartialDate('2025-07')).toEqual({ date: day('2025-07-01'), precision: 'MONTH' });
    expect(parsePartialDate('2025-07-30')).toEqual({ date: day('2025-07-30'), precision: 'DAY' });
    expect(formatPartialDate(day('2025-01-01'), 'YEAR')).toBe('2025');
    expect(formatPartialDate(day('2025-07-01'), 'MONTH')).toBe('2025-07');
    expect(formatPartialDate(day('2025-07-30'), 'DAY')).toBe('2025-07-30');
    expect(formatPartialDate(null, null)).toBeNull();
  });

  it('refuses dates no letter could give', () => {
    for (const bad of ['2025-02-30', '2025-13', '2025-00', '25', '2025/07', '07/2025', '2025-7', '']) {
      expect(parsePartialDate(bad)).toBeNull();
    }
    expect(parsePartialDate('2024-02-29')).not.toBeNull();
  });

  it('ends a period on its last day', () => {
    expect(endOfPeriod(day('2023-01-01'), 'YEAR')).toEqual(day('2023-12-31'));
    expect(endOfPeriod(day('2024-02-01'), 'MONTH')).toEqual(day('2024-02-29'));
    expect(endOfPeriod(day('2024-02-10'), 'DAY')).toEqual(day('2024-02-10'));
  });
});

describe('effectiveDateOf', () => {
  const none = { workStatus: 'COMPLETED', projectStart: null, projectStartPrecision: null, projectEnd: null, projectEndPrecision: null, signedAt: null };

  it('prefers the end, then the start, then the signature', () => {
    const signedAt = day('2026-01-01');
    expect(effectiveDateOf({ ...none, projectStart: day('2020-01-01'), projectStartPrecision: 'YEAR', projectEnd: day('2021-03-01'), projectEndPrecision: 'MONTH', signedAt })).toEqual(day('2021-03-31'));
    expect(effectiveDateOf({ ...none, projectStart: day('2020-01-01'), projectStartPrecision: 'YEAR', signedAt })).toEqual(day('2020-12-31'));
    expect(effectiveDateOf({ ...none, signedAt })).toEqual(signedAt);
    expect(effectiveDateOf(none)).toBeNull();
  });

  it('counts work still running when the customer signed up to the signature', () => {
    const running = { ...none, workStatus: 'IN_PROGRESS', projectStart: day('2023-03-17'), projectStartPrecision: 'DAY', signedAt: day('2026-01-30') };
    expect(effectiveDateOf(running)).toEqual(day('2026-01-30'));
    // A completed project started in 2023 ended then, whenever the letter came.
    expect(effectiveDateOf({ ...running, workStatus: 'COMPLETED' })).toEqual(day('2023-03-17'));
    // An end the letter gives wins, running or not.
    expect(effectiveDateOf({ ...running, projectEnd: day('2025-01-01'), projectEndPrecision: 'YEAR' })).toEqual(day('2025-12-31'));
  });
});

describe('amountHtOf', () => {
  it('takes the VAT out of a TTC amount only', () => {
    expect(amountHtOf(52_030_538, 'TTC')).toBe(43_358_781.67);
    expect(amountHtOf(27_552_400, 'HT')).toBe(27_552_400);
    expect(amountHtOf(6_653_280, null)).toBe(6_653_280);
    expect(amountHtOf(null, 'TTC')).toBeNull();
  });
});
