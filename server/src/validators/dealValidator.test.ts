import { describe, it, expect } from 'vitest';
import { createDealSchema, updateDealSchema } from './dealValidator.js';

/**
 * Deal request schemas.
 *
 * The interesting one is `updateDealSchema`. `dealService.update` passes the
 * parsed body straight to `prisma.deal.update({ data })`, so every key the
 * schema *invents* is written to the row — a PATCH is only a partial update if
 * the schema actually keeps it partial. A default surviving `.partial()` is
 * therefore not a cosmetic detail: it silently overwrites a column the caller
 * never mentioned.
 */

const PARTNER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const CUSTOMER_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';

describe('createDealSchema', () => {
  it('accepts the minimal deal and defaults the status', () => {
    const parsed = createDealSchema.parse({ title: 'Acme renewal', partnerId: PARTNER_ID });

    expect(parsed.title).toBe('Acme renewal');
    expect(parsed.status).toBe('TO_CHALLENGE');
  });

  it('requires a title and a partner', () => {
    expect(() => createDealSchema.parse({ partnerId: PARTNER_ID })).toThrow();
    expect(() => createDealSchema.parse({ title: 'Acme renewal' })).toThrow();
    expect(() => createDealSchema.parse({ title: '', partnerId: PARTNER_ID })).toThrow();
  });

  it('requires partnerId and customerId to be uuids', () => {
    // These land in Prisma relation filters; a non-uuid is a P2023 crash
    // surfacing as a 500 rather than the 400 it is.
    expect(() => createDealSchema.parse({ title: 'x', partnerId: 'partner-1' })).toThrow();
    expect(() => createDealSchema.parse({ title: 'x', partnerId: PARTNER_ID, customerId: 'customer-1' })).toThrow();
    expect(createDealSchema.parse({ title: 'x', partnerId: PARTNER_ID, customerId: CUSTOMER_ID }).customerId)
      .toBe(CUSTOMER_ID);
  });

  it('accepts a null customerId — a deal need not belong to a company', () => {
    expect(createDealSchema.parse({ title: 'x', partnerId: PARTNER_ID, customerId: null }).customerId).toBeNull();
  });

  it('trims the title and bounds it at 255 characters', () => {
    expect(createDealSchema.parse({ title: '  Acme renewal  ', partnerId: PARTNER_ID }).title).toBe('Acme renewal');
    expect(createDealSchema.parse({ title: 'a'.repeat(255), partnerId: PARTNER_ID }).title).toHaveLength(255);
    expect(() => createDealSchema.parse({ title: 'a'.repeat(256), partnerId: PARTNER_ID })).toThrow();
  });

  it('rejects a whitespace-only title', () => {
    // Trimming after the length check would let '   ' through as '', producing
    // a nameless row in the deals table that the user cannot identify.
    expect(() => createDealSchema.parse({ title: '   ', partnerId: PARTNER_ID })).toThrow();
  });

  it('accepts only the three known statuses', () => {
    for (const status of ['TO_CHALLENGE', 'APPROVED', 'DECLINED']) {
      expect(createDealSchema.parse({ title: 'x', partnerId: PARTNER_ID, status }).status).toBe(status);
    }
    expect(() => createDealSchema.parse({ title: 'x', partnerId: PARTNER_ID, status: 'WON' })).toThrow();
    expect(() => createDealSchema.parse({ title: 'x', partnerId: PARTNER_ID, status: 'approved' })).toThrow();
  });

  it('accepts empty strings and nulls for the optional text fields', () => {
    const parsed = createDealSchema.parse({
      title: 'x',
      partnerId: PARTNER_ID,
      products: '',
      notes: '',
      expiryDate: null,
    });

    expect(parsed.products).toBe('');
    expect(parsed.notes).toBe('');
    expect(parsed.expiryDate).toBeNull();
  });

  it('drops unknown keys instead of forwarding them to Prisma', () => {
    // `dealService.create` spreads the parsed body into the write, so an
    // unstripped key would be an unknown-column crash at runtime.
    const parsed = createDealSchema.parse({ title: 'x', partnerId: PARTNER_ID, userId: CUSTOMER_ID });

    expect(parsed).not.toHaveProperty('userId');
  });
});

describe('updateDealSchema', () => {
  it('does not resurrect the status default on a partial edit — REGRESSION', () => {
    // The bug: `createDealSchema.partial()` keeps `.default('TO_CHALLENGE')`
    // inside the optional wrapper, so `{ notes: 'called them' }` parsed to
    // `{ notes: 'called them', status: 'TO_CHALLENGE' }`. dealService.update
    // writes the parsed object verbatim, so editing the notes on an APPROVED
    // deal quietly reset it to TO_CHALLENGE — the pipeline moving backwards on
    // its own, with no trace of who did it.
    const parsed = updateDealSchema.parse({ notes: 'called them' });

    expect(parsed).not.toHaveProperty('status');
    expect(updateDealSchema.parse({})).toEqual({});
  });

  it('still writes a status the caller actually asked for', () => {
    expect(updateDealSchema.parse({ status: 'APPROVED' }).status).toBe('APPROVED');
  });

  it('allows editing one field without resupplying title and partner', () => {
    expect(updateDealSchema.parse({ title: 'Renamed' })).toEqual({ title: 'Renamed' });
  });

  it('still validates the fields that are present', () => {
    expect(() => updateDealSchema.parse({ title: '' })).toThrow();
    expect(() => updateDealSchema.parse({ title: '   ' })).toThrow();
    expect(() => updateDealSchema.parse({ partnerId: 'nope' })).toThrow();
    expect(() => updateDealSchema.parse({ status: 'WON' })).toThrow();
  });
});
