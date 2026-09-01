import { describe, it, expect } from 'vitest';
import { parsePagination, paginationMeta } from './pagination.js';

/**
 * Query-string pagination.
 *
 * Every value here arrives as an untrusted string off the wire, and the failure
 * that mattered was arithmetic rather than logical: `parseInt('x', 10)` is NaN,
 * and NaN survives every clamp around it, so `Math.max(1, NaN)` is still NaN.
 * That reached Prisma as `skip: NaN` and answered 500 on five list endpoints.
 */

describe('parsePagination', () => {
  it('defaults when nothing is supplied', () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it('reads ordinary values', () => {
    expect(parsePagination({ page: '3', limit: '50' })).toEqual({ page: 3, limit: 50, skip: 100 });
  });

  // '1e' is deliberately absent: parseInt('1e', 10) is 1, not NaN — it is a
  // trailing-garbage case, covered separately below.
  it.each(['x', '', 'NaN', 'null', '--5', ' '])(
    'falls back to the defaults for a non-numeric param (%s) — REGRESSION',
    (bad) => {
      // NaN passes every clamp: Math.max(1, NaN) === NaN. Prisma then rejects
      // `skip: NaN` and the endpoint answers 500 rather than a sane default.
      const result = parsePagination({ page: bad, limit: bad });

      expect(Number.isFinite(result.page)).toBe(true);
      expect(Number.isFinite(result.limit)).toBe(true);
      expect(Number.isFinite(result.skip)).toBe(true);
      expect(result).toEqual({ page: 1, limit: 20, skip: 0 });
    }
  );

  it('clamps a page below one', () => {
    expect(parsePagination({ page: '-4' })).toMatchObject({ page: 1, skip: 0 });
  });

  it('caps the page size so one request cannot pull everything', () => {
    expect(parsePagination({ limit: '5000' })).toMatchObject({ limit: 100 });
    expect(parsePagination({ limit: '0' })).toMatchObject({ limit: 1 });
  });

  it('accepts a trailing-garbage number the way parseInt does', () => {
    // '20abc' parses to 20. Documented rather than defended: it is harmless,
    // and rejecting it would be stricter than every other query param here.
    expect(parsePagination({ limit: '20abc' })).toMatchObject({ limit: 20 });
  });
});

describe('paginationMeta', () => {
  it('reports the page count for an exact multiple', () => {
    expect(paginationMeta(100, { page: 1, limit: 20, skip: 0 })).toEqual({
      page: 1,
      limit: 20,
      total: 100,
      totalPages: 5,
    });
  });

  it('rounds a partial last page up', () => {
    expect(paginationMeta(101, { page: 1, limit: 20, skip: 0 }).totalPages).toBe(6);
  });

  it('reports zero pages for an empty result rather than NaN', () => {
    expect(paginationMeta(0, { page: 1, limit: 20, skip: 0 }).totalPages).toBe(0);
  });
});
