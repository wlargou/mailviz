import { describe, it, expect } from 'vitest';
import { createContactSchema, updateContactSchema } from './contactValidator.js';

/**
 * Contact request schemas.
 *
 * Same class of bug as customerValidator's missing `domain`: Zod strips
 * anything absent from the schema without complaining, so a field left off the
 * update schema turns "save" into a silent no-op — the API returns 200 and the
 * value never changes. `isVip` is the one that matters here because the update
 * schema is derived (`.omit({ customerId: true }).partial()`), so it is one
 * refactor of the create schema away from losing the flag.
 *
 * The tests therefore assert that fields *survive* parsing, not merely that
 * bad input is rejected — the dangerous case is the request that passes.
 */
describe('updateContactSchema', () => {
  it('keeps isVip on update — REGRESSION', () => {
    const parsed = updateContactSchema.parse({ isVip: true });

    expect(parsed.isVip).toBe(true);
  });

  it('keeps isVip when set back to false', () => {
    // `false` is the value most likely to be lost to a truthiness check
    // downstream, so un-flagging a VIP deserves its own assertion.
    const parsed = updateContactSchema.parse({ isVip: false });

    expect(parsed.isVip).toBe(false);
  });

  it('keeps the other editable fields', () => {
    const input = {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@acme.com',
      phone: '+44 20 7946 0000',
      role: 'CTO',
      isVip: true,
    };

    expect(updateContactSchema.parse(input)).toEqual(input);
  });

  it('drops customerId — a contact cannot be reassigned via update', () => {
    const parsed = updateContactSchema.parse({
      firstName: 'Ada',
      customerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    });

    expect(parsed).not.toHaveProperty('customerId');
  });

  it('allows an empty update and still validates supplied fields', () => {
    expect(updateContactSchema.parse({})).toEqual({});
    expect(() => updateContactSchema.parse({ firstName: '' })).toThrow();
    expect(() => updateContactSchema.parse({ email: 'nope' })).toThrow();
  });
});

describe('createContactSchema', () => {
  it('keeps isVip on create', () => {
    const parsed = createContactSchema.parse({
      firstName: 'Ada',
      lastName: 'Lovelace',
      customerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      isVip: true,
    });

    expect(parsed.isVip).toBe(true);
  });

  it('requires firstName, lastName and a uuid customerId', () => {
    expect(() => createContactSchema.parse({ firstName: 'Ada', lastName: 'Lovelace' })).toThrow();
    expect(() =>
      createContactSchema.parse({
        firstName: 'Ada',
        lastName: 'Lovelace',
        customerId: 'not-a-uuid',
      })
    ).toThrow();
    expect(() =>
      createContactSchema.parse({
        firstName: '',
        lastName: 'Lovelace',
        customerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      })
    ).toThrow();
  });

  it('accepts empty strings for the optional contact details', () => {
    const parsed = createContactSchema.parse({
      firstName: 'Ada',
      lastName: 'Lovelace',
      customerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      email: '',
      phone: '',
      role: '',
    });

    expect(parsed.email).toBe('');
    expect(parsed.phone).toBe('');
    expect(parsed.role).toBe('');
  });
});
