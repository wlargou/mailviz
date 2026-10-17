import { describe, it, expect } from 'vitest';
import { amountInput, dateInput, formatAmount, parseAmount, parseDateInput, projectPeriod } from './clientReference';

describe('amounts', () => {
  it('reads the figure the way the letters print it, cents kept', () => {
    expect(parseAmount('29 688 094,80')).toBe(29688094.8);
    expect(parseAmount('8.143.701,29')).toBe(8143701.29);
    expect(parseAmount('52 030 538 DH')).toBe(52030538);
    expect(parseAmount('1,500,000.50')).toBe(1500000.5);
    expect(parseAmount('1500000')).toBe(1500000);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('12 abc')).toBeUndefined();
    expect(parseAmount('1.5.0')).toBeUndefined();
  });

  it('writes it back grouped, with cents only when there are some', () => {
    expect(formatAmount(29688094.8)).toBe('29 688 094,80 DH');
    expect(formatAmount(52030538)).toBe('52 030 538 DH');
    expect(formatAmount(1000, 'EUR')).toBe('1 000 EUR');
    expect(formatAmount(null)).toBe('—');
    expect(amountInput(29688094.8)).toBe('29 688 094,80');
    expect(parseAmount(amountInput(8143701.29))).toBe(8143701.29);
  });
});

describe('dates', () => {
  it('reads a year, a month or a day, as written or in ISO', () => {
    expect(parseDateInput('2025')).toBe('2025');
    expect(parseDateInput('07/2025')).toBe('2025-07');
    expect(parseDateInput('7/2025')).toBe('2025-07');
    expect(parseDateInput('30/07/2025')).toBe('2025-07-30');
    expect(parseDateInput('2025-07-30')).toBe('2025-07-30');
    expect(parseDateInput(' ')).toBeNull();
  });

  it('refuses what is not a date', () => {
    for (const bad of ['31/02/2025', '13/2025', '2025/07/30x', 'juillet 2025', '25']) expect(parseDateInput(bad)).toBeUndefined();
  });

  it('shows dates the way the letters write them', () => {
    expect(dateInput('2025-07-30')).toBe('30/07/2025');
    expect(dateInput('2025-07')).toBe('07/2025');
    expect(dateInput(null)).toBe('');
    expect(projectPeriod({ projectStart: '2022', projectEnd: '2023' })).toBe('2022 – 2023');
    expect(projectPeriod({ projectStart: '2025', projectEnd: '2025' })).toBe('2025');
    expect(projectPeriod({ projectStart: null, projectEnd: null })).toBe('—');
  });
});
