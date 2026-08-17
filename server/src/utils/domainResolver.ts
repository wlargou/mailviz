import { env } from '../config/env.js';

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.fr', 'yahoo.co.uk',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me',
  'zoho.com', 'yandex.com', 'mail.com',
  'gmx.com', 'gmx.de',
]);

/**
 * Second-level labels that belong to the public suffix rather than to the
 * organisation, when they sit under a two-letter country TLD. `intelcom.co.ma`
 * and `lydec.co.ma` are two different companies, so the registrable domain is
 * three labels, not two.
 *
 * This list previously held only the government/education labels, which is why
 * `gov.ma` worked and `co.ma` did not: every `*.co.ma` sender normalised to the
 * bare suffix `co.ma` and was filed under one customer named "CO" — 25 distinct
 * Moroccan companies in one row, 673 emails. `com` had the same effect for
 * `com.tn`, `com.br` and 16 other suffixes.
 *
 * A full public-suffix list would be more complete, but the entries below cover
 * every suffix present in this database and stay auditable. Note the guard in
 * `hasCountrySecondLevel`: the branch only fires when the final label is exactly
 * two letters, so adding `com` here cannot affect an ordinary `.com` domain.
 */
const COUNTRY_SECOND_LEVEL_LABELS = new Set([
  // commercial / organisational
  'co', 'com', 'net', 'org', 'biz', 'info', 'ltd', 'plc', 'firm', 'store',
  // government / education / military
  'gov', 'gob', 'gouv', 'government', 'edu', 'ac', 'sch', 'mil',
  // regional conventions (.jp, .kr, .id, .au, …)
  'or', 'ne', 'in', 'gr', 'lg', 'go', 'asn', 'id', 'gen',
]);

// Country-code TLDs (2-letter) — used to detect multi-part TLDs like .co.uk, .gov.ma
const CCTLD_PATTERN = /^[a-z]{2}$/;

/**
 * True when the domain ends in a two-part public suffix such as `.co.ma` or
 * `.gov.uk`, meaning the organisation's own label is the third from the right.
 *
 * The two-letter check on the final label is what makes this safe: it can only
 * ever match a country TLD, never `.com` or `.org`.
 */
function hasCountrySecondLevel(parts: string[]): boolean {
  if (parts.length < 3) return false;
  return (
    COUNTRY_SECOND_LEVEL_LABELS.has(parts[parts.length - 2]) &&
    CCTLD_PATTERN.test(parts[parts.length - 1])
  );
}

/**
 * True when a domain is *nothing but* a two-part public suffix — `co.ma`,
 * `com.tn`, `co.uk`. No organisation owns such a domain, so a customer holding
 * one was produced by the resolver bug this module used to have, and every
 * message filed under it belongs to some other company.
 *
 * Used by the repair script to identify the junk customers.
 */
export function isBarePublicSuffix(domain: string): boolean {
  const parts = domain.toLowerCase().split('.');
  return (
    parts.length === 2 &&
    COUNTRY_SECOND_LEVEL_LABELS.has(parts[0]) &&
    CCTLD_PATTERN.test(parts[1])
  );
}

/**
 * Domains belonging to mailing-list and community platforms rather than to a
 * company you do business with.
 *
 * The personal-domain exclusion has always kept Gmail and Outlook out of the
 * customer list; these are the same idea for lists. Without them the two largest
 * "customers" after the account's own company were `connectedcommunity.org`
 * (12,758 messages) and `googlegroups.com` (3,735) — a community platform and a
 * list host, neither of which is an organisation anyone sells to.
 */
const MAILING_LIST_DOMAINS = new Set([
  'googlegroups.com', 'connectedcommunity.org', 'higherlogic.com',
  'groups.io', 'freelists.org', 'librelist.com', 'simplelists.com',
  'mailman.com', 'listserv.com', 'sympa.org', 'topicbox.com',
]);

/**
 * Leading labels that mark a host as list infrastructure — `lists.example.org`
 * is the list server, not the organisation's mail domain.
 */
const MAILING_LIST_PREFIXES = new Set(['lists', 'list', 'listserv', 'groups', 'group', 'mailman']);

/**
 * A syntactically valid hostname: dot-separated labels of alphanumerics and
 * hyphens, no empty labels, hyphens never on a boundary, and an alphabetic TLD.
 *
 * `extractDomain` used to return whatever followed the last `@`, so mangled
 * Exchange and Domino headers produced customers on domains like `powerm.ma/o=`
 * and `ibm.comclaudiabeisiegel/poughkeepsie/ibm`.
 */
const VALID_DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

function isValidDomain(domain: string): boolean {
  if (domain.length > 253) return false;
  if (!VALID_DOMAIN.test(domain)) return false;
  return domain.split('.').every((label) => label.length >= 1 && label.length <= 63);
}

/** True when a domain is a mailing list or community platform, not a company. */
export function isMailingListDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  if (MAILING_LIST_DOMAINS.has(lower) || MAILING_LIST_DOMAINS.has(normalizeDomain(lower))) {
    return true;
  }
  const labels = lower.split('.');
  return labels.length > 2 && MAILING_LIST_PREFIXES.has(labels[0]);
}

export function extractDomain(email: string): string | null {
  // Strip angle brackets, quotes, and whitespace that may trail from malformed email headers
  const cleaned = email.replace(/[<>"';\s]+/g, '');
  const at = cleaned.lastIndexOf('@');
  if (at < 1) return null;
  const domain = cleaned.slice(at + 1).toLowerCase().trim();
  if (!domain) return null;
  // Rejected rather than returned as-is: an unparseable domain became a customer.
  return isValidDomain(domain) ? domain : null;
}

/**
 * Normalize a full domain to its "root" company domain.
 * - tr.ibm.com → ibm.com
 * - douane.gov.ma → douane.gov.ma (kept as-is, two-part suffix)
 * - intelcom.co.ma → intelcom.co.ma (kept as-is, two-part suffix)
 * - info.lydec.co.ma → lydec.co.ma
 * - mail.google.com → google.com
 * - ibm.com → ibm.com (no change)
 */
export function normalizeDomain(domain: string): string {
  const parts = domain.split('.');
  if (parts.length <= 2) return domain;

  // Two-part public suffix (org.gov.ma, intelcom.co.ma): the organisation's own
  // label is the third from the right, so keep three.
  if (hasCountrySecondLevel(parts)) {
    return parts.slice(-3).join('.');
  }

  // For regular corporate subdomains (tr.ibm.com, mail.google.com),
  // take the last 2 parts as the root domain
  return parts.slice(-2).join('.');
}

export function isPersonalDomain(domain: string): boolean {
  // Also check the normalized form so sub.gmail.com is caught
  return PERSONAL_DOMAINS.has(domain) || PERSONAL_DOMAINS.has(normalizeDomain(domain));
}

export function domainToCompanyName(domain: string): string {
  const parts = domain.split('.');

  // Two-part public suffix: the company name is the label before it.
  // e.g. douane.gov.ma → "Douane", intelcom.co.ma → "Intelcom"
  if (hasCountrySecondLevel(parts)) {
    const orgName = parts[parts.length - 3];
    if (orgName.length <= 4) return orgName.toUpperCase();
    return orgName.charAt(0).toUpperCase() + orgName.slice(1).toLowerCase();
  }

  // For regular domains, use the second-level domain (before TLD)
  // ibm.com → "ibm", powerm.ma → "powerm"
  const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];

  // Short names (≤4 chars) → uppercase (IBM, SAP, OCP, AWS)
  if (name.length <= 4) {
    return name.toUpperCase();
  }

  // Otherwise capitalize first letter, split on hyphens
  return name
    .split(/-/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(' ');
}

export function parseName(
  displayName: string | null,
  email: string,
): { firstName: string; lastName: string } {
  // Clean the display name: strip quotes, angle brackets, bracketed tags
  let cleaned = displayName?.trim()
    ?.replace(/^["'<]+|["'>]+$/g, '')  // Strip leading/trailing quotes and angle brackets
    ?.replace(/\[.*?\]/g, '')           // Strip bracketed suffixes like [C]
    ?.trim() || null;

  if (cleaned && cleaned.includes(' ')) {
    const parts = cleaned.split(/\s+/);
    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(' '),
    };
  }

  if (cleaned) {
    return { firstName: cleaned, lastName: '' };
  }

  // Fall back to email prefix
  const prefix = email.split('@')[0] || 'Unknown';
  const segments = prefix.split(/[._-]/);

  if (segments.length >= 2) {
    return {
      firstName: capitalize(segments[0]),
      lastName: segments.slice(1).map(capitalize).join(' '),
    };
  }

  return { firstName: capitalize(segments[0]), lastName: '' };
}

export function getLogoUrl(domain: string): string {
  return `https://img.logo.dev/${domain}?token=${env.LOGO_DEV_TOKEN}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
