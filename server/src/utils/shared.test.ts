import { describe, it, expect } from 'vitest';
import * as cron from 'node-cron';
import { cleanEmptyStrings, secondsToCron } from './shared.js';

/**
 * The two shared helpers, both of which fail in ways that are invisible at the
 * call site.
 *
 * `secondsToCron` feeds `cron.schedule` directly in both sync schedulers. An
 * expression node-cron rejects does not degrade — it throws out of
 * `startEmailSyncScheduler()`, which runs during `index.ts` boot, so the whole
 * server fails to start. Every case below therefore checks the output against
 * node-cron's own validator rather than against a string we happen to expect.
 *
 * `cleanEmptyStrings` sits between the request body and a Prisma `update`. It
 * has to distinguish three things Javascript is happy to conflate: `''`
 * (the user cleared the field — write null), `undefined` (the field was not in
 * the payload — leave it alone), and falsy-but-real values like `0` and `false`.
 * Collapsing any pair of those silently destroys data on every edit.
 */

describe('secondsToCron', () => {
  it('produces an expression node-cron accepts across the whole supported range', () => {
    // The doc comment promises 10s–3600s. Anything in that window reaches
    // cron.schedule verbatim, and an invalid one takes the server down at boot.
    for (const seconds of [10, 11, 15, 30, 45, 59, 60, 61, 90, 120, 299, 300, 900, 1800, 3599, 3600]) {
      const expr = secondsToCron(seconds);
      expect(cron.validate(expr), `${seconds}s produced ${JSON.stringify(expr)}`).toBe(true);
    }
  });

  it('uses the six-field seconds form below a minute and the five-field form at or above', () => {
    // Not cosmetic: `*/90 * * * *` in the *minutes* field is out of range, and
    // `*/1 * * * *` in the seconds field means every second. Picking the wrong
    // form either crashes the scheduler or hammers Gmail 60x too often.
    expect(secondsToCron(59).split(' ')).toHaveLength(6);
    expect(secondsToCron(60).split(' ')).toHaveLength(5);
    expect(secondsToCron(61).split(' ')).toHaveLength(5);
  });

  it('maps the boundary values to the cadence they were asked for', () => {
    expect(secondsToCron(10)).toBe('*/10 * * * * *');
    expect(secondsToCron(59)).toBe('*/59 * * * * *');
    expect(secondsToCron(60)).toBe('*/1 * * * *');
    expect(secondsToCron(120)).toBe('*/2 * * * *');
    expect(secondsToCron(3600)).toBe('*/60 * * * *');
  });

  it('never emits a step of zero for any interval a scheduler can pass it', () => {
    // The schedulers clamp with Math.max(10, …) precisely because `*/0` makes
    // node-cron throw `Invalid array length`. This asserts the other half: that
    // nothing at or above the clamp can produce a zero step either.
    for (let seconds = 10; seconds <= 3600; seconds++) {
      expect(secondsToCron(seconds)).not.toContain('*/0 ');
    }
  });
});

describe('cleanEmptyStrings', () => {
  it('turns an empty string into null so clearing a field actually clears it', () => {
    expect(cleanEmptyStrings({ notes: '', website: 'https://x.test' })).toEqual({
      notes: null,
      website: 'https://x.test',
    });
  });

  it('leaves undefined alone so an absent field is not wiped — REGRESSION', () => {
    // Prisma reads `undefined` as "do not touch this column" and `null` as
    // "set it to NULL". Rewriting this helper as `value || null` — the obvious
    // simplification — turns every field missing from a PATCH body into a
    // deliberate erase, so editing a customer's name blanks its address,
    // industry and notes.
    const cleaned = cleanEmptyStrings({ name: 'Acme', notes: undefined });

    expect(cleaned.notes).toBeUndefined();
    expect('notes' in cleaned).toBe(true);
  });

  it('preserves falsy values that are real data', () => {
    // `0` is a legitimate deal amount and `false` a legitimate flag. Under
    // `value || null` both become null and the number the user typed is gone.
    const cleaned = cleanEmptyStrings({ amount: 0, isActive: false, count: NaN });

    expect(cleaned.amount).toBe(0);
    expect(cleaned.isActive).toBe(false);
    expect(cleaned.count).toBeNaN();
  });

  it('passes non-string values through untouched by identity', () => {
    // Dates and arrays must arrive at Prisma as the same objects, not as
    // serialised copies — a cloned Date is still a Date, but a cloned Prisma
    // relation payload is not the same thing.
    const due = new Date('2026-01-01T00:00:00.000Z');
    const products = ['a', 'b'];
    const nested = { deep: '' };

    const cleaned = cleanEmptyStrings({ due, products, nested, missing: null });

    expect(cleaned.due).toBe(due);
    expect(cleaned.products).toBe(products);
    // Shallow on purpose: nested objects are opaque JSON columns, not columns
    // whose emptiness we get to reinterpret.
    expect(cleaned.nested).toBe(nested);
    expect(cleaned.nested.deep).toBe('');
    expect(cleaned.missing).toBeNull();
  });

  it('does not mutate its input', () => {
    const input = { notes: '' };

    cleanEmptyStrings(input);

    expect(input.notes).toBe('');
  });

  it('returns an empty object for an empty payload rather than throwing', () => {
    expect(cleanEmptyStrings({})).toEqual({});
  });
});
