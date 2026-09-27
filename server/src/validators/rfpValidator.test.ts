import { describe, it, expect } from 'vitest';
import { createRfpSchema, setVerifiersSchema, updateRfpSchema, verificationSchema } from './rfpValidator.js';

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

    const full = {
      ...valid,
      portalUrl: 'https://portailachats.bankalmaghrib.ma/',
      isGoe: true,
      status: 'WORKING' as const,
      notes: 'Lot unique',
      lots: [{ title: 'Serveurs', budget: 12500000.5 }, { title: 'Stockage', budget: null }],
      composition: { kinds: ['ADMINISTRATIF' as const, 'OFFRE_FINANCIERE' as const], prefill: true },
    };
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

  it('bounds the lot budgets, and keeps the status, format and dossier kinds closed sets', () => {
    expect(() => createRfpSchema.parse({ ...valid, lots: [{ title: 'Lot 1', budget: -1 }] })).toThrow();
    expect(createRfpSchema.parse({ ...valid, lots: [{ title: 'Lot 1', budget: 0 }] }).lots![0].budget).toBe(0);
    expect(createRfpSchema.parse({ ...valid, lots: [{ title: 'Lot 1', budget: null }] }).lots![0].budget).toBeNull();
    // A tender has at least one lot — an empty list is not "no lots", it is a mistake.
    expect(() => createRfpSchema.parse({ ...valid, lots: [] })).toThrow();
    expect(() => createRfpSchema.parse({ ...valid, lots: [{ title: '   ' }] })).toThrow();
    expect(() => createRfpSchema.parse({ ...valid, composition: { kinds: ['DOSSIER_SECRET'], prefill: true } })).toThrow();
    // The total is derived; it is no longer something a caller can send.
    expect(createRfpSchema.parse({ ...valid, budget: 5 })).not.toHaveProperty('budget');

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
    // Lots and composition have their own endpoints; a PATCH cannot replace them.
    expect(updateRfpSchema.parse({ lots: [{ title: 'x' }] })).not.toHaveProperty('lots');
    expect(updateRfpSchema.parse({ composition: { kinds: [], prefill: false } })).not.toHaveProperty('composition');
    expect(() => updateRfpSchema.parse({ status: 'ARCHIVED' })).toThrow();
  });
});

describe('verificationSchema', () => {
  it('takes an approval with or without a comment', () => {
    expect(verificationSchema.safeParse({ decision: 'APPROVED' }).success).toBe(true);
    expect(verificationSchema.safeParse({ decision: 'APPROVED', comment: 'RAS' }).success).toBe(true);
  });

  it('wants a real comment on changes requested', () => {
    expect(verificationSchema.safeParse({ decision: 'CHANGES_REQUESTED' }).success).toBe(false);
    // Trimmed before the length check, so spaces are not a reason.
    expect(verificationSchema.safeParse({ decision: 'CHANGES_REQUESTED', comment: '   ' }).success).toBe(false);
    const ok = verificationSchema.safeParse({ decision: 'CHANGES_REQUESTED', comment: '  Cachet manquant ' });
    expect(ok.success && ok.data.comment).toBe('Cachet manquant');
  });

  it('knows no other decision', () => {
    expect(verificationSchema.safeParse({ decision: 'REJECTED', comment: 'x' }).success).toBe(false);
  });
});

describe('setVerifiersSchema', () => {
  it('takes a list of user ids, possibly empty', () => {
    expect(setVerifiersSchema.safeParse({ userIds: [] }).success).toBe(true);
    expect(setVerifiersSchema.safeParse({ userIds: ['3f1c7a52-8f0e-4c1a-9d5b-2a6e8b0c4d11'] }).success).toBe(true);
    expect(setVerifiersSchema.safeParse({ userIds: ['alice'] }).success).toBe(false);
    expect(setVerifiersSchema.safeParse({}).success).toBe(false);
  });
});
