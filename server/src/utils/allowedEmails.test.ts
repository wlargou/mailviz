import { describe, it, expect } from 'vitest';
import { isEmailAllowed } from './allowedEmails.js';

/**
 * The sign-in gate.
 *
 * Every interesting case here is a near-miss — a domain that merely ends
 * with the allowed one, a subdomain, an address with the domain in its
 * local part. An inline `endsWith` passes the happy path and fails all
 * three, which is why this is a function with tests.
 */
describe('isEmailAllowed', () => {
  it('admits everyone at an allowed domain', () => {
    const rules = ['@powerm.ma'];

    expect(isEmailAllowed('l.walid@powerm.ma', rules)).toBe(true);
    expect(isEmailAllowed('someone.else@powerm.ma', rules)).toBe(true);
    expect(isEmailAllowed('L.Walid@PowerM.MA', rules)).toBe(true);
    expect(isEmailAllowed('  spaced@powerm.ma  ', rules)).toBe(true);
  });

  it('refuses the domains that merely look like it', () => {
    const rules = ['@powerm.ma'];

    // `endsWith('powerm.ma')` would admit every one of these.
    expect(isEmailAllowed('attacker@evil-powerm.ma', rules)).toBe(false);
    expect(isEmailAllowed('attacker@notpowerm.ma', rules)).toBe(false);
    expect(isEmailAllowed('attacker@powerm.ma.attacker.com', rules)).toBe(false);
    // The domain appearing in the local part is not the domain.
    expect(isEmailAllowed('powerm.ma@gmail.com', rules)).toBe(false);
    expect(isEmailAllowed('someone@gmail.com', rules)).toBe(false);
  });

  it('does not admit subdomains of an allowed domain', () => {
    // Whoever controls a subdomain is not necessarily the same people, so
    // this is opt-in: list `@mail.powerm.ma` too if that is wanted.
    expect(isEmailAllowed('someone@mail.powerm.ma', ['@powerm.ma'])).toBe(false);
    expect(isEmailAllowed('someone@mail.powerm.ma', ['@powerm.ma', '@mail.powerm.ma'])).toBe(true);
  });

  it('still admits whole addresses, and mixes them with domains', () => {
    const rules = ['contractor@partner.com', '@powerm.ma'];

    expect(isEmailAllowed('contractor@partner.com', rules)).toBe(true);
    expect(isEmailAllowed('CONTRACTOR@partner.com', rules)).toBe(true);
    expect(isEmailAllowed('anyone@powerm.ma', rules)).toBe(true);
    expect(isEmailAllowed('someone.else@partner.com', rules)).toBe(false);
  });

  it('treats an empty list as open access, and nothing else as open', () => {
    expect(isEmailAllowed('anyone@anywhere.com', [])).toBe(true);
    // A list of blanks is still a list — it must not fall open.
    expect(isEmailAllowed('anyone@anywhere.com', ['', '  '])).toBe(false);
  });

  it('refuses anything that is not an address', () => {
    const rules = ['@powerm.ma'];

    expect(isEmailAllowed('powerm.ma', rules)).toBe(false);
    expect(isEmailAllowed('@powerm.ma', rules)).toBe(false);
    expect(isEmailAllowed('someone@', rules)).toBe(false);
    expect(isEmailAllowed('', rules)).toBe(false);
  });

  it('uses the last @, so a quoted local part cannot smuggle a domain in', () => {
    // `"a@powerm.ma"@evil.com` has domain evil.com, not powerm.ma.
    expect(isEmailAllowed('"a@powerm.ma"@evil.com', ['@powerm.ma'])).toBe(false);
    expect(isEmailAllowed('"a@evil.com"@powerm.ma', ['@powerm.ma'])).toBe(true);
  });
});
