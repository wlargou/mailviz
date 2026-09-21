import { describe, it, expect } from 'vitest';
import { createRfpSchema, updateRfpSchema } from './rfpValidator.js';

/**
 * The register's front door.
 *
 * Two things are worth pinning. A tender with no deadline is not actionable,
 * so `deadlineAt` is required where almost everything else is optional. And
 * `portalUrl` ends up in an `href` and a `window.open` on the client, where
 * `z.string().url()` alone is not enough — `javascript:` is a well-formed URL.
 */
const valid = {
  name: 'Refonte de la plateforme matérielle AIX',
  reference: '70/AOO/BKAM/2026',
  deadlineAt: '2026-09-09T10:00:00.000Z',
  submissionFormat: 'PORTAL' as const,
};

describe('createRfpSchema', () => {
  it('accepts a minimal tender and a fully specified one', () => {
    expect(createRfpSchema.parse(valid)).toEqual(valid);

    const full = { ...valid, portalUrl: 'https://portailachats.bankalmaghrib.ma/', isGoe: true, budget: 12500000.5, status: 'WORKING' as const, notes: 'Lot unique' };
    expect(createRfpSchema.parse(full)).toEqual(full);
  });

  it('requires a deadline — a tender without one cannot be acted on', () => {
    const { deadlineAt: _omitted, ...withoutDeadline } = valid;
    expect(() => createRfpSchema.parse(withoutDeadline)).toThrow();
    expect(() => createRfpSchema.parse({ ...valid, deadlineAt: '09/09/2026' })).toThrow();
    expect(() => createRfpSchema.parse({ ...valid, deadlineAt: '2026-09-09' })).toThrow();
  });

  it('trims before the length check, so whitespace is not a name', () => {
    expect(createRfpSchema.parse({ ...valid, name: '  Refonte AIX  ' }).name).toBe('Refonte AIX');
    expect(() => createRfpSchema.parse({ ...valid, name: '   ' })).toThrow();
    expect(() => createRfpSchema.parse({ ...valid, reference: '   ' })).toThrow();
  });

  it('refuses a portal URL that is not http(s)', () => {
    // Both parse clean as URLs and both reach an href on the client.
    expect(() => createRfpSchema.parse({ ...valid, portalUrl: 'javascript:alert(1)' })).toThrow();
    expect(() => createRfpSchema.parse({ ...valid, portalUrl: 'data:text/html,<script>' })).toThrow();
    expect(createRfpSchema.parse({ ...valid, portalUrl: 'http://marchespublics.gov.ma' }).portalUrl).toBe('http://marchespublics.gov.ma');
  });

  it('bounds the budget and keeps the status and format closed sets', () => {
    expect(() => createRfpSchema.parse({ ...valid, budget: -1 })).toThrow();
    expect(createRfpSchema.parse({ ...valid, budget: 0 }).budget).toBe(0);
    expect(createRfpSchema.parse({ ...valid, budget: null }).budget).toBeNull();

    expect(() => createRfpSchema.parse({ ...valid, status: 'PENDING' })).toThrow();
    expect(() => createRfpSchema.parse({ ...valid, submissionFormat: 'FAX' })).toThrow();
    for (const status of ['OPEN', 'WORKING', 'SUBMITTED', 'WON', 'LOST', 'NO_BID', 'CANCELLED']) {
      expect(createRfpSchema.parse({ ...valid, status }).status).toBe(status);
    }
  });

  it('drops unknown keys — a caller cannot smuggle in an owner', () => {
    expect(createRfpSchema.parse({ ...valid, userId: 'someone-else', id: 'x' })).toEqual(valid);
  });
});

describe('updateRfpSchema', () => {
  it('leaves an absent field absent rather than reviving a default', () => {
    // The `updateDealSchema` trap: `.partial()` keeps a `.default()` inside
    // the optional wrapper, so an absent field on a PATCH parses as the
    // default and overwrites the row. `createRfpSchema` declares none.
    expect(updateRfpSchema.parse({})).toEqual({});
    expect(updateRfpSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(updateRfpSchema.parse({})).not.toHaveProperty('status');
    expect(updateRfpSchema.parse({})).not.toHaveProperty('submissionFormat');
    expect(updateRfpSchema.parse({})).not.toHaveProperty('isGoe');
  });

  it('still applies the field rules it inherits', () => {
    expect(() => updateRfpSchema.parse({ portalUrl: 'javascript:alert(1)' })).toThrow();
    expect(() => updateRfpSchema.parse({ budget: -5 })).toThrow();
    expect(() => updateRfpSchema.parse({ status: 'ARCHIVED' })).toThrow();
  });
});
