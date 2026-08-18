/**
 * Is this address a person, a shared function, or a machine?
 *
 * The vocabulary below is taken from this database rather than invented: local
 * parts that repeat across many different domains are, almost by definition,
 * roles rather than names — `contact` appears on 167 domains, `noreply` on 150,
 * `info` on 95, `support` on 91.
 *
 * The same query is why matching is anchored on whole words and never a
 * substring search. `john` (7 domains), `david` (5), `alex` (5) and `matt` (4)
 * repeat too, and a contains-style rule would file every `alexandre.*` as a role.
 */

export type ContactKind = 'person' | 'role' | 'automated';

/**
 * Addresses nobody reads. Replying goes nowhere, so these should never be offered
 * as a recipient or counted as a relationship.
 */
const AUTOMATED = [
  'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply',
  'do-not-respond', 'donotrespond', 'nepasrepondre', 'ne-pas-repondre',
  'mailer-daemon', 'mailerdaemon', 'postmaster', 'bounces', 'daemon',
  'notification', 'notifications', 'sysadmin', 'mailer', 'newsletter', 'newsletters',
  'webmaster', 'no-response', 'automated',
];

/**
 * Machine words that are also plausible human names, so they only count when they
 * are the *entire* local part.
 *
 * `welcome.mncube@ibm.com` is Welcome Mncube — a real first name — and matching
 * "welcome" as a word inside a compound filed a person as a robot. Validating the
 * classifier against the whole contact table is what surfaced it.
 */
const AUTOMATED_EXACT = [
  'welcome', 'news', 'auto', 'alert', 'alerts', 'notify', 'system', 'root',
  'updates', 'digest', 'registration', 'bounce', 'reply', 'mail',
];

/**
 * Shared mailboxes. A human may well read these, which is why they are their own
 * category rather than lumped in with the machines — you can reasonably
 * correspond with `support@`, you cannot with `noreply@`.
 */
const ROLE = [
  'contact', 'contacts', 'contactez', 'info', 'infos', 'information', 'hello', 'hi',
  'bonjour', 'support', 'help', 'helpdesk', 'customercare', 'customer-care',
  'customerservice', 'service', 'services', 'sav',
  'sales', 'marketing', 'communication', 'communications', 'comms', 'press', 'media',
  'team', 'teams', 'events', 'event', 'training', 'webinar', 'webinars', 'learn',
  'partners', 'partner', 'community',
  'billing', 'invoice', 'invoices', 'facturation', 'account', 'accounts',
  'accounting', 'comptabilite', 'compta', 'finance', 'finances', 'tresorerie',
  'achats', 'purchasing', 'fournisseur', 'fournisseurs', 'procurement', 'devis',
  'hr', 'rh', 'recrutement', 'recruitment', 'careers', 'jobs', 'talent',
  'admin', 'administration', 'administrateur', 'office', 'general', 'enquiries',
  'direction', 'secretariat', 'secretaire', 'assistante',
  'informatique', 'securite', 'security', 'qualite', 'quality',
  'commercial', 'commerciale', 'juridique', 'compliance', 'privacy',
  'abuse', 'management',
];

/**
 * Role words that are also names, abbreviations or common words — whole local
 * part only. `hi`, `general`, `office`, `media`, `talent` and two-letter
 * department codes are all things a surname or initial could collide with.
 */
const ROLE_EXACT = [
  'hi', 'sav', 'rh', 'dsi', 'it', 'compta', 'general', 'office', 'media',
  'talent', 'partner', 'legal', 'dpo', 'ceo', 'event', 'learn', 'community',
];

const AUTOMATED_SET = new Set(AUTOMATED);
const ROLE_SET = new Set(ROLE);
const AUTOMATED_EXACT_SET = new Set(AUTOMATED_EXACT);
const ROLE_EXACT_SET = new Set(ROLE_EXACT);

/**
 * Split a local part into words, so `support-technique`, `no_reply` and
 * `securite.telecom` are all recognised without substring matching.
 */
function words(localPart: string): string[] {
  return localPart.toLowerCase().split(/[.\-_+]/).filter(Boolean);
}

/** Lowercase, accents stripped, punctuation collapsed — for name comparison. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function classifyContactKind(input: {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** The company this contact belongs to, if known. */
  companyName?: string | null;
}): ContactKind {
  const email = input.email?.trim().toLowerCase();
  if (!email || !email.includes('@')) return 'person';

  const localPart = email.slice(0, email.lastIndexOf('@'));
  const parts = words(localPart);
  const whole = localPart;
  // `no-reply` is one token to a reader but three to the splitter.
  const compact = whole.replace(/[.\-_]/g, '');

  if (
    AUTOMATED_SET.has(whole) || AUTOMATED_SET.has(compact) ||
    AUTOMATED_EXACT_SET.has(whole) || AUTOMATED_EXACT_SET.has(compact)
  ) {
    return 'automated';
  }
  if (
    ROLE_SET.has(whole) || ROLE_SET.has(compact) ||
    ROLE_EXACT_SET.has(whole) || ROLE_EXACT_SET.has(compact)
  ) {
    return 'role';
  }

  // Then by word. Automated wins: `noreply-billing` is still a machine.
  if (parts.some((word) => AUTOMATED_SET.has(word))) return 'automated';
  if (parts.some((word) => ROLE_SET.has(word))) return 'role';

  /**
   * A display name identical to the company's is a brand, not a person —
   * "Figma <support+notifications@figma.com>", "Replit <contact@mail.replit.com>".
   * Restricted to single-token names: a real person at a one-word company would
   * otherwise be caught by anything looser.
   */
  const displayName = normalise(`${input.firstName ?? ''} ${input.lastName ?? ''}`);
  const company = normalise(input.companyName ?? '');
  if (displayName && company && displayName === company && !displayName.includes(' ')) {
    return 'role';
  }

  return 'person';
}
