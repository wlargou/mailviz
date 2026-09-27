import { describe, it, expect } from 'vitest';
import { parseBudget, readiness, readyNeedsVerifiers, verificationStates, type RfpItemVerification, type RfpVerifier } from './rfp';

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
