import { describe, it, expect } from 'vitest';
import { createDealPartnerSchema, updateDealPartnerSchema } from './dealPartnerValidator.js';

/**
 * Deal partner (vendor) request schemas.
 *
 * A partner is a lookup row referenced by every deal, and the two URL fields go
 * straight into the UI: `logoUrl` becomes an `<img src>` and `registrationUrl`
 * the target of a `window.open` in DealsPage. `.url()` alone does NOT make that
 * safe — Zod accepts any well-formed URI including `javascript:` and `data:` —
 * so the schema pins the scheme to http/https, and the cases below are what
 * hold that in place. Deals are shareable, so the payload would reach a second
 * user's browser.
 *
 * The empty-string branch matters as much as the URL check: the settings form
 * submits '' for a cleared field, so a schema that only accepted a valid URL or
 * `undefined` would make clearing a logo impossible.
 */

describe('createDealPartnerSchema', () => {
  it('accepts a name on its own', () => {
    expect(createDealPartnerSchema.parse({ name: 'Cisco' })).toEqual({ name: 'Cisco' });
  });

  it('requires a name', () => {
    expect(() => createDealPartnerSchema.parse({})).toThrow();
    expect(() => createDealPartnerSchema.parse({ name: '' })).toThrow();
  });

  it('trims the name before checking it is non-empty', () => {
    // Trimming after min(1) would let '   ' through as '', leaving a nameless
    // partner in the dropdown that no deal can be meaningfully attributed to.
    expect(createDealPartnerSchema.parse({ name: '  Cisco  ' }).name).toBe('Cisco');
    expect(() => createDealPartnerSchema.parse({ name: '   ' })).toThrow();
  });

  it('bounds the name at 255 characters', () => {
    expect(createDealPartnerSchema.parse({ name: 'a'.repeat(255) }).name).toHaveLength(255);
    expect(() => createDealPartnerSchema.parse({ name: 'a'.repeat(256) })).toThrow();
  });

  it('requires the URLs to be real URLs', () => {
    expect(createDealPartnerSchema.parse({ name: 'Cisco', registrationUrl: 'https://cisco.com/partners' })
      .registrationUrl).toBe('https://cisco.com/partners');

    expect(() => createDealPartnerSchema.parse({ name: 'Cisco', registrationUrl: 'cisco.com' })).toThrow();
    expect(() => createDealPartnerSchema.parse({ name: 'Cisco', registrationUrl: 'not a url' })).toThrow();
    expect(() => createDealPartnerSchema.parse({ name: 'Cisco', logoUrl: 'logo.png' })).toThrow();
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('refuses the %s scheme', (url) => {
    // Every one of these is a well-formed URI that `z.string().url()` accepts on
    // its own. `registrationUrl` is opened with `window.open`, so accepting them
    // is stored XSS that travels to whoever the deal is shared with.
    expect(() => createDealPartnerSchema.parse({ name: 'Cisco', registrationUrl: url })).toThrow();
    expect(() => createDealPartnerSchema.parse({ name: 'Cisco', logoUrl: url })).toThrow();
  });

  it('still accepts plain http, not only https', () => {
    // An internal partner portal on http must remain usable — the control is on
    // the scheme being a web scheme, not on transport security.
    expect(
      createDealPartnerSchema.parse({ name: 'Cisco', registrationUrl: 'http://portal.internal/x' })
        .registrationUrl
    ).toBe('http://portal.internal/x');
  });

  it('accepts empty strings so a URL can be cleared', () => {
    const parsed = createDealPartnerSchema.parse({ name: 'Cisco', registrationUrl: '', logoUrl: '' });

    expect(parsed.registrationUrl).toBe('');
    expect(parsed.logoUrl).toBe('');
  });

  it('bounds the URLs at 500 characters', () => {
    const at500 = `https://cisco.com/${'a'.repeat(482)}`;
    expect(at500).toHaveLength(500);
    expect(createDealPartnerSchema.parse({ name: 'Cisco', logoUrl: at500 }).logoUrl).toBe(at500);
    expect(() => createDealPartnerSchema.parse({ name: 'Cisco', logoUrl: `${at500}a` })).toThrow();
  });

  it('drops unknown keys', () => {
    expect(createDealPartnerSchema.parse({ name: 'Cisco', id: 'injected' })).not.toHaveProperty('id');
  });
});

describe('updateDealPartnerSchema', () => {
  it('accepts a single-field edit — the settings page patches one field at a time', () => {
    expect(updateDealPartnerSchema.parse({ registrationUrl: 'https://cisco.com' }))
      .toEqual({ registrationUrl: 'https://cisco.com' });
    expect(updateDealPartnerSchema.parse({})).toEqual({});
  });

  it('still validates the fields that are present', () => {
    expect(() => updateDealPartnerSchema.parse({ name: '' })).toThrow();
    expect(() => updateDealPartnerSchema.parse({ name: '   ' })).toThrow();
    expect(() => updateDealPartnerSchema.parse({ logoUrl: 'nope' })).toThrow();
  });

  it('invents no fields the caller did not send', () => {
    // The service writes the parsed body to the row, so an invented key here
    // would overwrite a column the caller never mentioned.
    expect(Object.keys(updateDealPartnerSchema.parse({ name: 'Cisco' }))).toEqual(['name']);
  });
});
