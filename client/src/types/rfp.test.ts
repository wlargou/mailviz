import { describe, it, expect } from 'vitest';
import { parseBudget, readiness } from './rfp';

describe('parseBudget', () => {
  it('reads an amount the way the Avis prints it', () => {
    expect(parseBudget('1500000')).toBe(1500000);
    expect(parseBudget('1 500 000')).toBe(1500000);
    // Narrow no-break spaces are what a PDF copy usually carries.
    expect(parseBudget('1 500 000,00')).toBe(1500000);
    expect(parseBudget('1.500.000')).toBe(1500000);
    expect(parseBudget('1.500.000,00 DH')).toBe(1500000);
    expect(parseBudget('630000.50')).toBe(630001);
  });

  it('tells an empty field from one that is not an amount', () => {
    expect(parseBudget('')).toBeNull();
    expect(parseBudget('   ')).toBeNull();
    expect(parseBudget('abc')).toBeUndefined();
    expect(parseBudget('1,5,0')).toBeUndefined();
    // Three decimals is a grouping, not cents — and not a valid one here.
    expect(parseBudget('1500,000')).toBeUndefined();
  });
});

describe('readiness', () => {
  it('counts ready pieces out of those that apply', () => {
    expect(readiness([{ status: 'READY' }, { status: 'TODO' }, { status: 'NOT_APPLICABLE' }, { status: 'IN_PROGRESS' }])).toEqual({
      ready: 1,
      total: 3,
    });
    expect(readiness([])).toEqual({ ready: 0, total: 0 });
  });
});
