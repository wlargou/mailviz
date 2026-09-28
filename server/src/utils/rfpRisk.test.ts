import { describe, it, expect } from 'vitest';
import { isAtRisk } from './rfpRisk.js';

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 28, 9);
const tender = (over: Partial<{ status: string; deadlineAt: Date; createdAt: Date; publishedAt: Date | null }> = {}) => ({
  status: 'WORKING',
  createdAt: new Date(now - 10 * DAY),
  deadlineAt: new Date(now + 10 * DAY),
  publishedAt: null,
  ...over,
});

/** Mirrors client/src/types/rfp.test.ts's tenderRisk cases — the two must agree. */
describe('isAtRisk', () => {
  it('flags readiness behind the time used', () => {
    expect(isAtRisk(tender(), { ready: 1, total: 4 }, now)).toBe(true);
    expect(isAtRisk(tender(), { ready: 3, total: 4 }, now)).toBe(false);
  });
  it('counts from publication when known', () => {
    expect(isAtRisk(tender({ publishedAt: new Date(now - 30 * DAY) }), { ready: 2, total: 3 }, now)).toBe(true);
  });
  it('gives a just-registered tender a moment', () => {
    expect(isAtRisk(tender({ createdAt: new Date(now - 0.5 * DAY) }), { ready: 0, total: 5 }, now)).toBe(false);
  });
  it('flags a passed deadline, and never a submitted, finished or empty tender', () => {
    expect(isAtRisk(tender({ deadlineAt: new Date(now - DAY) }), { ready: 5, total: 5 }, now)).toBe(true);
    expect(isAtRisk(tender({ status: 'SUBMITTED' }), { ready: 0, total: 4 }, now)).toBe(false);
    expect(isAtRisk(tender({ status: 'WON' }), { ready: 0, total: 4 }, now)).toBe(false);
    expect(isAtRisk(tender(), { ready: 0, total: 0 }, now)).toBe(false);
  });
});
