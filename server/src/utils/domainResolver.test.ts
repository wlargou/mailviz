import { describe, it, expect } from 'vitest';
import {
  extractDomain,
  isMailingListDomain,
  normalizeDomain,
  isPersonalDomain,
  domainToCompanyName,
} from './domainResolver.js';

/**
 * Domain resolution decides which customer a message is filed under, so a bug
 * here is not cosmetic: it silently merges unrelated organisations.
 *
 * The two-part-suffix cases below are taken from real addresses in the
 * development database. Before the fix, every one of them normalised to the
 * bare public suffix — 25 distinct Moroccan companies, 673 emails and 278
 * contacts were filed under a single customer named "CO", and 18 more suffixes
 * produced a second bucket named "COM".
 */

describe('extractDomain', () => {
  it('takes the part after the last @', () => {
    expect(extractDomain('someone@intelcom.co.ma')).toBe('intelcom.co.ma');
  });

  it('tolerates the junk that arrives in malformed headers', () => {
    expect(extractDomain('<"someone"@Intelcom.CO.MA> ')).toBe('intelcom.co.ma');
  });

  it('returns null when there is no usable domain', () => {
    expect(extractDomain('not-an-address')).toBeNull();
    expect(extractDomain('@leading.com')).toBeNull();
  });
});

describe('normalizeDomain — two-part public suffixes', () => {
  // Each of these is a real domain from the database that used to collapse.
  it.each([
    'intelcom.co.ma',
    'lydec.co.ma',
    'deloitte.co.ma',
    'cih.co.ma',
    'bmcebank.co.ma',
    'cosumar.co.ma',
    'adm.co.ma',
    'cmi.co.ma',
  ])('keeps %s whole instead of collapsing it to co.ma', (domain) => {
    expect(normalizeDomain(domain)).toBe(domain);
  });

  it('keeps unrelated companies on the same suffix apart', () => {
    // This is the actual defect: one customer named "CO" held both.
    expect(normalizeDomain('intelcom.co.ma')).not.toBe(normalizeDomain('lydec.co.ma'));
  });

  it.each([
    ['acme.com.tn', 'acme.com.tn'],
    ['acme.com.br', 'acme.com.br'],
    ['acme.co.uk', 'acme.co.uk'],
    ['acme.co.jp', 'acme.co.jp'],
    ['acme.or.jp', 'acme.or.jp'],
    ['acme.ne.jp', 'acme.ne.jp'],
    ['acme.co.za', 'acme.co.za'],
    ['acme.com.au', 'acme.com.au'],
  ])('treats %s as a whole registrable domain', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it('still strips subdomains above a two-part suffix', () => {
    expect(normalizeDomain('info.lydec.co.ma')).toBe('lydec.co.ma');
    expect(normalizeDomain('mail.smtp.acme.co.uk')).toBe('acme.co.uk');
  });

  it('keeps the government cases that already worked', () => {
    expect(normalizeDomain('douane.gov.ma')).toBe('douane.gov.ma');
    expect(normalizeDomain('hmrc.gov.uk')).toBe('hmrc.gov.uk');
  });
});

describe('normalizeDomain — ordinary domains are unaffected', () => {
  /**
   * The regression risk of adding `com` to the suffix list is that it might
   * start eating ordinary `.com` domains. It cannot: the branch requires the
   * final label to be exactly two letters, which `com` never is.
   */
  it.each([
    ['ibm.com', 'ibm.com'],
    ['tr.ibm.com', 'ibm.com'],
    ['mail.google.com', 'google.com'],
    ['com.com', 'com.com'],
    ['acme.com.com', 'com.com'],
    ['powerm.ma', 'powerm.ma'],
    ['acme.co', 'acme.co'],
    ['sub.acme.co', 'acme.co'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});

describe('domainToCompanyName', () => {
  it('names the organisation, not the public suffix', () => {
    expect(domainToCompanyName('intelcom.co.ma')).toBe('Intelcom');
    expect(domainToCompanyName('lydec.co.ma')).toBe('Lydec');
    expect(domainToCompanyName('deloitte.co.ma')).toBe('Deloitte');
  });

  it('no longer produces the junk names that swallowed real companies', () => {
    for (const domain of ['intelcom.co.ma', 'cosumar.co.ma', 'acme.com.tn']) {
      expect(domainToCompanyName(domain)).not.toBe('CO');
      expect(domainToCompanyName(domain)).not.toBe('COM');
    }
  });

  it('uppercases short names and title-cases longer ones', () => {
    expect(domainToCompanyName('ibm.com')).toBe('IBM');
    expect(domainToCompanyName('cmi.co.ma')).toBe('CMI');
    expect(domainToCompanyName('powerm.ma')).toBe('Powerm');
  });

  it('keeps the government cases', () => {
    expect(domainToCompanyName('douane.gov.ma')).toBe('Douane');
  });

  it('splits hyphenated names', () => {
    expect(domainToCompanyName('credit-agricole.co.ma')).toBe('Credit-agricole');
  });
});

describe('isPersonalDomain', () => {
  it('recognises personal mail hosts, including via subdomain', () => {
    expect(isPersonalDomain('gmail.com')).toBe(true);
    expect(isPersonalDomain('mail.gmail.com')).toBe(true);
  });

  it('does not treat a company domain as personal', () => {
    expect(isPersonalDomain('intelcom.co.ma')).toBe(false);
    expect(isPersonalDomain('powerm.ma')).toBe(false);
  });
});

describe('extractDomain — rejects what cannot be a domain', () => {
  /**
   * These are real captured values. Mangled Exchange and Domino headers used to
   * become customers, because whatever followed the last `@` was returned as-is.
   */
  it.each([
    'someone@powerm.ma/o=exchangelabs',
    'claudia@ibm.comclaudiabeisiegel/poughkeepsie/ibm',
    'a@medte',
    'a@n',
    'a@-leading.com',
    'a@trailing-.com',
    'a@double..dot.com',
    'a@.leading.dot',
    'a@trailing.dot.',
    'a@under_score.com',
    'a@1.2.3.4',
  ])('rejects %s', (address) => {
    expect(extractDomain(address)).toBeNull();
  });

  it('strips embedded whitespace before validating, rather than rejecting', () => {
    // Whitespace removal is deliberate — it is how wrapped and mangled headers
    // are recovered — so this yields a usable domain instead of nothing.
    expect(extractDomain('a@spaced domain.com')).toBe('spaceddomain.com');
  });

  it.each([
    ['someone@intelcom.co.ma', 'intelcom.co.ma'],
    ['someone@ibm.com', 'ibm.com'],
    ['someone@mail.smtp.acme.co.uk', 'mail.smtp.acme.co.uk'],
    ['someone@my-company.io', 'my-company.io'],
    ['someone@a1.example.com', 'a1.example.com'],
  ])('still accepts %s', (address, expected) => {
    expect(extractDomain(address)).toBe(expected);
  });
});

describe('isMailingListDomain', () => {
  it.each([
    'googlegroups.com',
    'connectedcommunity.org',
    'groups.io',
    'lists.apache.org',
    'listserv.example.org',
    'groups.acme.com',
  ])('treats %s as list infrastructure', (domain) => {
    expect(isMailingListDomain(domain)).toBe(true);
  });

  it('catches a subdomain of a known list host', () => {
    expect(isMailingListDomain('foo.googlegroups.com')).toBe(true);
  });

  it.each([
    'intelcom.co.ma',
    'ibm.com',
    'powerm.ma',
    // A company that merely *has* a word like "group" in its name is not a list.
    'groupe-renault.fr',
    'grouponsupplier.com',
  ])('does not treat %s as a list', (domain) => {
    expect(isMailingListDomain(domain)).toBe(false);
  });
});
