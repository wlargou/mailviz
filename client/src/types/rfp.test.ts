import { describe, it, expect } from 'vitest';
import { parseBudget, readiness, readyNeedsVerifiers, tenderRisk, verificationStates, type RfpItemVerification, type RfpVerifier } from './rfp';

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

describe('verificationStates', () => {
  const person = (id: string) => ({ id, name: id, email: `${id}@x`, avatarUrl: null });
  const verifiers: RfpVerifier[] = ['a', 'b', 'c', 'd'].map((id) => ({ id: `v${id}`, rfpId: 'r', userId: id, createdAt: '', user: person(id) }));
  const doc = (id: string, version: number) => ({ id, rfpId: 'r', kind: 'OTHER' as const, filename: '', mimeType: '', size: 0, version, uploadedById: null, createdAt: '' });
  const decided = (userId: string, documentId: string, decision: RfpItemVerification['decision']): RfpItemVerification => ({
    id: userId, itemId: 'i', userId, documentId, decision, comment: null, createdAt: '', updatedAt: '', user: person(userId),
  });

  it("reads each verifier's standing on the current version", () => {
    const item = {
      documents: [doc('v1', 1), doc('v2', 2)],
      verifications: [decided('a', 'v2', 'APPROVED'), decided('b', 'v2', 'CHANGES_REQUESTED'), decided('c', 'v1', 'APPROVED')],
    };
    expect(verificationStates(item, verifiers).map((s) => [s.person.id, s.state])).toEqual([
      ['a', 'approved'],
      ['b', 'changes'],
      // An approval of v1 says nothing about v2.
      ['c', 'stale'],
      ['d', 'pending'],
    ]);
  });

  it('has everyone pending when there is nothing to verify', () => {
    expect(verificationStates({ documents: [], verifications: [] }, verifiers).every((s) => s.state === 'pending')).toBe(true);
    expect(verificationStates({ documents: [], verifications: [] }, verifiers)).toHaveLength(4);
  });

  it('gates Ready only with verifiers and a file', () => {
    expect(readyNeedsVerifiers({ documents: [doc('v1', 1)] }, verifiers)).toBe(true);
    expect(readyNeedsVerifiers({ documents: [] }, verifiers)).toBe(false);
    expect(readyNeedsVerifiers({ documents: [doc('v1', 1)] }, [])).toBe(false);
  });
});

describe('tenderRisk', () => {
  const day = 86_400_000;
  const now = Date.UTC(2026, 8, 28, 9);
  const tender = (over: Partial<{ status: string; deadlineAt: string; createdAt: string; publishedAt: string | null }> = {}) => ({
    status: 'WORKING' as const,
    createdAt: new Date(now - 10 * day).toISOString(),
    deadlineAt: new Date(now + 10 * day).toISOString(),
    publishedAt: null,
    ...over,
  }) as never;

  it('flags readiness behind the time used', () => {
    // Half the time gone, a quarter ready.
    expect(tenderRisk(tender(), { ready: 1, total: 4 }, now)).toMatchObject({ atRisk: true, timeUsed: 0.5, ready: 0.25 });
    // Half the time gone, three quarters ready.
    expect(tenderRisk(tender(), { ready: 3, total: 4 }, now).atRisk).toBe(false);
  });

  it('counts from publication when it is known', () => {
    // Published 30 days ago: 75% of the time is gone, not 50%.
    const t = tender({ publishedAt: new Date(now - 30 * day).toISOString() });
    expect(tenderRisk(t, { ready: 2, total: 3 }, now)).toMatchObject({ atRisk: true, timeUsed: 0.75 });
  });

  it('gives a just-registered tender a moment before calling it late', () => {
    const t = tender({ createdAt: new Date(now - 0.5 * day).toISOString() });
    expect(tenderRisk(t, { ready: 0, total: 5 }, now).atRisk).toBe(false);
  });

  it('calls a passed deadline overdue, and says nothing of a submitted, finished or empty tender', () => {
    const past = tender({ deadlineAt: new Date(now - day).toISOString() });
    expect(tenderRisk(past, { ready: 5, total: 5 }, now)).toMatchObject({ atRisk: true, overdue: true });
    expect(tenderRisk(tender({ status: 'SUBMITTED' }), { ready: 0, total: 4 }, now).atRisk).toBe(false);
    expect(tenderRisk(tender({ status: 'WON' }), { ready: 0, total: 4 }, now).atRisk).toBe(false);
    expect(tenderRisk(tender(), { ready: 0, total: 0 }, now).atRisk).toBe(false);
  });
});
