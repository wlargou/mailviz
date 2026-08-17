/**
 * Duplicate-contact matching primitives.
 *
 * These rules were chosen by looking at the real database (11.4k auto-created
 * contacts across 2.5k companies), not from first principles. What that data
 * showed:
 *
 *  - Contacts are created from `From:` headers by `customerService.findOrCreateContact`,
 *    which dedupes on the exact address. So the same address appearing twice is
 *    rare (2 rows) and only happens when two sync workers race — both rows have
 *    identical field values and identical millisecond timestamps.
 *  - The real duplicate is one person holding several *addresses* on one domain:
 *    `ahmed.bouna@dell.com` / `ahmed_bouna@dell.com`, `y.nadif@` / `y_nadif@`,
 *    `s.safae@` / `ssafae@`, plus malformed captures like `-lassaad.jaziri@…`
 *    and `y..idrissi@…`. Separator-insensitive comparison of the local part
 *    catches all of these.
 *  - Display-name equality on its own is worthless here: it produced 1,587
 *    candidate pairs, almost all of them machine senders ("Slack" across 51
 *    per-message no-reply addresses, "Noreply" across 19 Oracle Cloud regions),
 *    and at least one pair of genuinely different people who happened to share a
 *    captured display name (`barbara.rainho@dataiku.com` vs
 *    `marissa.creatore@dataiku.com`, both stored as "Barbara Rainho"). It is
 *    therefore only ever used as *corroboration*, never as a match on its own.
 *  - The domain guard matters. `domainToCompanyName` collapses `intelcom.co.ma`
 *    and `lydec.co.ma` into one "CO" company, so "same company" does not imply
 *    "same organisation". Every alias rule additionally requires the two
 *    addresses to share a root domain, which is what keeps
 *    `contact@intelcom.co.ma` away from `contact@lydec.co.ma`.
 */

import { normalizeDomain } from './domainResolver.js';

export type MatchRule = 'exact_email' | 'alias_local_part' | 'initial_form';
export type MatchConfidence = 'high' | 'medium';

export const RULE_CONFIDENCE: Record<MatchRule, MatchConfidence> = {
  exact_email: 'high',
  alias_local_part: 'medium',
  initial_form: 'medium',
};

/** Rules that only count when the two display names also agree. */
export const RULE_REQUIRES_NAME_AGREEMENT: Record<MatchRule, boolean> = {
  exact_email: false,
  alias_local_part: true,
  initial_form: true,
};

/**
 * Gmail is the one provider that documents its addresses as dot-insensitive and
 * `+tag`-stripping, so `j.smith+news@gmail.com` and `jsmith@gmail.com` really
 * are one mailbox. Nothing else is treated that way — on the corporate domains
 * in this data, `+` distinguishes senders rather than tagging one mailbox
 * (Ariba routes four different parties through `s4system-prodeu+<doc-id>@`).
 */
const DOT_INSENSITIVE_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export interface ParsedAddress {
  local: string;
  domain: string;
  /** The registrable domain — `help.dell.com` and `dell.com` both give `dell.com`. */
  rootDomain: string;
}

/**
 * The registrable domain: `help.dell.com` → `dell.com`, `gti.co.ma` → `gti.co.ma`.
 *
 * This used to be a stricter local copy, because `normalizeDomain` collapsed
 * every `*.co.ma` sender to the bare suffix and matching cannot afford to treat
 * two organisations as one. That bug is fixed at the source, so there is now a
 * single definition of a root domain and the two cannot drift apart.
 */
const rootDomain = normalizeDomain;

/**
 * Split an address into its parts, tolerating the junk that reaches us from
 * malformed headers (angle brackets, quotes, stray whitespace).
 */
export function parseAddress(raw: string | null | undefined): ParsedAddress | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[<>"';\s]+/g, '').toLowerCase();
  const at = cleaned.lastIndexOf('@');
  if (at < 1 || at === cleaned.length - 1) return null;
  const local = cleaned.slice(0, at);
  const domain = cleaned.slice(at + 1);
  if (!local || !domain || !domain.includes('.')) return null;
  return { local, domain, rootDomain: rootDomain(domain) };
}

/**
 * Rule 1 — the same mailbox, written the same way.
 *
 * Case and surrounding junk are normalised away; Gmail's documented dot/`+tag`
 * equivalence is applied only for Gmail.
 */
export function exactEmailKey(raw: string | null | undefined): string | null {
  const parsed = parseAddress(raw);
  if (!parsed) return null;
  if (DOT_INSENSITIVE_DOMAINS.has(parsed.rootDomain)) {
    const local = parsed.local.split('+')[0].replace(/\./g, '');
    if (!local) return null;
    return `${local}@gmail.com`;
  }
  return `${parsed.local}@${parsed.domain}`;
}

/**
 * Rule 2 — the same local part written with different separators, on the same
 * root domain. `ahmed.bouna@dell.com` ≡ `ahmed_bouna@dell.com`,
 * `dave@fontawesome.com` ≡ `dave@m.fontawesome.com`.
 *
 * `+tag` is deliberately NOT stripped here: on corporate domains the tag
 * identifies the sender, so stripping it merges unrelated people.
 */
export function aliasLocalPartKey(raw: string | null | undefined): string | null {
  const parsed = parseAddress(raw);
  if (!parsed) return null;
  const local = DOT_INSENSITIVE_DOMAINS.has(parsed.rootDomain)
    ? parsed.local.split('+')[0]
    : parsed.local;
  const stripped = local.replace(/[._-]/g, '');
  if (!stripped) return null;
  return `${stripped}@${parsed.rootDomain}`;
}

/**
 * Rule 3 — the initial form of a name-shaped local part.
 * `john.smith@acme.com` and `jsmith@acme.com` both reduce to `jsmith@acme.com`.
 *
 * A local part with no separator is returned as-is, which is what lets the
 * abbreviated side meet the spelled-out side. Single-token local parts
 * therefore also collide with each other, but that case is already an
 * `alias_local_part` match, so nothing new is claimed.
 */
export function initialFormKey(raw: string | null | undefined): string | null {
  const parsed = parseAddress(raw);
  if (!parsed) return null;
  const local = DOT_INSENSITIVE_DOMAINS.has(parsed.rootDomain)
    ? parsed.local.split('+')[0]
    : parsed.local;
  const segments = local.split(/[._-]+/).filter(Boolean);
  if (segments.length === 0) return null;
  if (segments.length === 1) return `${segments[0]}@${parsed.rootDomain}`;
  const [first, ...rest] = segments;
  return `${first[0]}${rest.join('')}@${parsed.rootDomain}`;
}

/**
 * A comparable form of a display name: diacritics folded, punctuation dropped,
 * tokens deduplicated and sorted.
 *
 * Sorting is what makes "Azgaou, Karim" match "Karim Azgaou" — Gmail hands us
 * both orders for the same person depending on the sending client.
 */
export function nameKey(firstName: string | null, lastName: string | null): string {
  const raw = `${firstName ?? ''} ${lastName ?? ''}`;
  const folded = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks left behind by NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!folded) return '';
  const tokens = Array.from(new Set(folded.split(' '))).sort();
  return tokens.join(' ');
}

export function keyForRule(rule: MatchRule, email: string | null | undefined): string | null {
  switch (rule) {
    case 'exact_email':
      return exactEmailKey(email);
    case 'alias_local_part':
      return aliasLocalPartKey(email);
    case 'initial_form':
      return initialFormKey(email);
  }
}

/** Human-readable justification, shown next to every candidate group in the UI. */
export const RULE_LABEL: Record<MatchRule, string> = {
  exact_email: 'Same email address',
  alias_local_part: 'Same address written differently, same domain, same name',
  initial_form: 'Abbreviated form of the same address, same name',
};
