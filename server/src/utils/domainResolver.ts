const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.fr', 'yahoo.co.uk',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me',
  'zoho.com', 'yandex.com', 'mail.com',
  'gmx.com', 'gmx.de',
]);

// Government/education second-level domains that indicate the org name is the subdomain before them
const GOV_EDU_SLDS = new Set([
  'gov', 'gob', 'government', 'edu', 'ac', 'mil', 'org',
]);

// Country-code TLDs (2-letter) — used to detect multi-part TLDs like .co.uk, .gov.ma
const CCTLD_PATTERN = /^[a-z]{2}$/;

export function extractDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  return email.slice(at + 1).toLowerCase().trim() || null;
}

/**
 * Normalize a full domain to its "root" company domain.
 * - tr.ibm.com → ibm.com
 * - douane.gov.ma → douane.gov.ma (kept as-is, gov pattern)
 * - mail.google.com → google.com
 * - ibm.com → ibm.com (no change)
 */
export function normalizeDomain(domain: string): string {
  const parts = domain.split('.');
  if (parts.length <= 2) return domain;

  // Check for gov/edu pattern: org.gov.cc (e.g. douane.gov.ma)
  // Structure: [...subdomains, org, sld, cctld]
  if (parts.length >= 3) {
    const maybeSld = parts[parts.length - 2];
    const maybeCctld = parts[parts.length - 1];
    if (GOV_EDU_SLDS.has(maybeSld) && CCTLD_PATTERN.test(maybeCctld)) {
      // e.g. douane.gov.ma → keep the 3 rightmost parts
      return parts.slice(-3).join('.');
    }
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

  // Handle gov/edu pattern: org.gov.cc → company name is the org part
  // e.g. douane.gov.ma → "Douane"
  if (parts.length >= 3) {
    const maybeSld = parts[parts.length - 2];
    const maybeCctld = parts[parts.length - 1];
    if (GOV_EDU_SLDS.has(maybeSld) && CCTLD_PATTERN.test(maybeCctld)) {
      const orgName = parts[parts.length - 3];
      if (orgName.length <= 4) return orgName.toUpperCase();
      return orgName.charAt(0).toUpperCase() + orgName.slice(1).toLowerCase();
    }
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
  return `https://logo.clearbit.com/${domain}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
