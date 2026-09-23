/**
 * Who may sign in.
 *
 * `ALLOWED_EMAILS` is a comma-separated list where each entry is either a
 * whole address (`someone@powerm.ma`) or a domain written with its leading
 * `@` (`@powerm.ma`), which admits everyone at that domain. An empty list is
 * open access, which is what a local checkout runs with.
 *
 * This is the only thing standing between a Google account and the data, so
 * it is a function with tests rather than three lines inside the OAuth
 * callback: the interesting cases are all near-misses, and near-misses are
 * exactly what an inline `endsWith` gets wrong.
 */

/** The domain of an address — whatever follows the LAST `@`. */
function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

export function isEmailAllowed(email: string, rules: readonly string[]): boolean {
  // No rules configured is open access — the documented local default.
  if (rules.length === 0) return true;

  const address = email.trim().toLowerCase();
  const domain = domainOf(address);
  if (!domain) return false;

  return rules.some((rawRule) => {
    const rule = rawRule.trim().toLowerCase();
    if (!rule) return false;

    if (rule.startsWith('@')) {
      // Equality, never `endsWith`: `endsWith('powerm.ma')` would admit
      // `evil-powerm.ma`, and matching the rule as a suffix of the address
      // would admit `powerm.ma.attacker.com`. Subdomains are not included
      // either — `@powerm.ma` does not admit `x@mail.powerm.ma`, because
      // whoever controls a subdomain is not necessarily the same people.
      return domain === rule.slice(1);
    }

    return address === rule;
  });
}
