import { describe, it, expect } from 'vitest';
import { createCustomerSchema, updateCustomerSchema } from './customerValidator.js';

/**
 * Customer (company) request schemas.
 *
 * REGRESSION on `domain`. Zod strips unknown keys by default, so a field that
 * is missing from the schema does not produce an error — it silently
 * disappears between the request and the service layer. `domain` was missing
 * here, so companies created through the API were written with no domain at
 * all, and the request looked like it had succeeded.
 *
 * The consequence surfaced somewhere else entirely: email -> customer
 * auto-linking keys off the sender's domain (see utils/domainResolver.ts), so
 * every manually created company simply never linked to any mail, and the
 * feature looked broken rather than the create endpoint looking broken.
 *
 * That failure mode — a silently dropped field — is why these are field
 * survival tests rather than "does the schema reject bad input" tests. The
 * dangerous case is the one that passes validation.
 */
describe('createCustomerSchema', () => {
  it('keeps domain — REGRESSION', () => {
    const parsed = createCustomerSchema.parse({
      name: 'Acme Corp',
      domain: 'acme.com',
    });

    expect(parsed.domain).toBe('acme.com');
  });

  it('keeps domain alongside every other optional field', () => {
    // Guards against a partial fix that works in isolation but gets lost when
    // the field list is next reordered or edited.
    const input = {
      name: 'Acme Corp',
      email: 'hello@acme.com',
      phone: '+33 1 23 45 67 89',
      company: 'Acme Holdings',
      website: 'https://acme.com',
      domain: 'acme.com',
      notes: 'Key account',
      isVip: true,
    };

    expect(createCustomerSchema.parse(input)).toEqual(input);
  });

  it('accepts an empty domain without dropping the key', () => {
    // The UI submits '' for a cleared field; the schema's `.or(z.literal(''))`
    // has to let that through so the service can clear the stored value.
    const parsed = createCustomerSchema.parse({ name: 'Acme Corp', domain: '' });

    expect(parsed.domain).toBe('');
  });

  it('keeps isVip and categoryId', () => {
    const categoryId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const parsed = createCustomerSchema.parse({
      name: 'Acme Corp',
      isVip: true,
      categoryId,
    });

    expect(parsed.isVip).toBe(true);
    expect(parsed.categoryId).toBe(categoryId);
  });

  it('requires a non-empty name', () => {
    expect(() => createCustomerSchema.parse({})).toThrow();
    expect(() => createCustomerSchema.parse({ name: '' })).toThrow();
  });

  it('rejects a malformed email and a non-uuid categoryId', () => {
    expect(() => createCustomerSchema.parse({ name: 'Acme', email: 'nope' })).toThrow();
    expect(() => createCustomerSchema.parse({ name: 'Acme', categoryId: 'not-a-uuid' })).toThrow();
  });
});

describe('updateCustomerSchema', () => {
  it('keeps domain on a partial update — REGRESSION', () => {
    const parsed = updateCustomerSchema.parse({ domain: 'acme.com' });

    expect(parsed.domain).toBe('acme.com');
  });

  it('allows updating a single field without resupplying name', () => {
    expect(updateCustomerSchema.parse({ isVip: true })).toEqual({ isVip: true });
    expect(updateCustomerSchema.parse({})).toEqual({});
  });

  it('still validates the fields that are present', () => {
    expect(() => updateCustomerSchema.parse({ name: '' })).toThrow();
    expect(() => updateCustomerSchema.parse({ email: 'nope' })).toThrow();
  });
});
