import { isIP } from 'node:net';
import { env } from './env.js';

/**
 * Which upstream hops may be believed about who the client is.
 *
 * Without this, `req.ip` is the socket peer — measured in production as
 * `::ffff:100.64.0.9`, Railway's internal proxy — which is the SAME value for
 * every request on earth. The login rate limiter keys on it, so its bucket of
 * 20 per 15 minutes was shared by the entire internet: not a defence, a lockout
 * vector, since anyone could exhaust it and keep the owner from signing in.
 *
 * `trust proxy: true` is the tempting one-liner and it is worse than doing
 * nothing: it makes Express believe the leftmost `X-Forwarded-For` entry, which
 * the client writes. Rate limiting then becomes opt-out — send a fresh fake IP
 * per request and no bucket ever fills.
 *
 * So this is an allow-list of hops instead. `proxy-addr` walks
 * X-Forwarded-For from the right and stops at the first address NOT on this
 * list; that address is the client. A forged entry sits further left and is
 * never reached.
 *
 * Two paths reach this app and both had to work:
 *
 *  - **Through Cloudflare** (mailviz.rkube.io): the chain is
 *    `client, cf-edge` with Railway's proxy as the peer. Trusting the CGNAT
 *    hop alone would stop at the Cloudflare edge and bucket everyone behind
 *    that edge together, so Cloudflare's own ranges are trusted too.
 *  - **Direct to the Railway domain**, which is publicly reachable and does
 *    NOT pass through Cloudflare — verified: it answers `server:
 *    railway-hikari` with no `cf-ray`. On that path Railway appends the real
 *    client, so the rightmost untrusted entry is already correct, and a
 *    client-supplied `CF-Connecting-IP` is worthless — which is exactly why
 *    this keys on the hop list rather than on that header.
 */

/**
 * Cloudflare's published edge ranges, from cloudflare.com/ips-v4 and /ips-v6.
 *
 * Fetched 2026-09-02. Cloudflare changes these rarely but does change them; a
 * stale entry degrades gracefully (that hop stops being trusted, so the key
 * becomes the Cloudflare edge rather than the client — coarser, never unsafe).
 * Re-fetch if per-client limiting starts behaving like per-region.
 */
export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
] as const;

/**
 * Railway routes container traffic over carrier-grade NAT space, so the socket
 * peer is always inside 100.64.0.0/10 — confirmed from production access logs.
 */
const RAILWAY_INTERNAL = '100.64.0.0/10';

/** The hops trusted when TRUSTED_PROXIES is unset: Railway behind Cloudflare. */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = [
  'loopback',
  'linklocal',
  'uniquelocal',
  RAILWAY_INTERNAL,
  ...CLOUDFLARE_RANGES,
];

/** proxy-addr's names for whole ranges, as Express's `trust proxy` takes them. */
const NAMED_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

/**
 * An address, an address with a CIDR prefix, or a named range.
 *
 * A /0 is refused: it trusts every address, which is `trust proxy: true` by
 * another name — the leftmost, client-written X-Forwarded-For entry wins.
 * Netmask notation (`/255.0.0.0`), which proxy-addr also reads, is refused for
 * simplicity; write the prefix.
 */
function isValidEntry(entry: string): boolean {
  if (NAMED_RANGES.has(entry)) return true;
  const [address, prefix, ...rest] = entry.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits > 0 && bits <= (family === 4 ? 32 : 128);
}

/**
 * The trusted hops: TRUSTED_PROXIES when set, otherwise the list above.
 *
 * Set, it replaces the list rather than adding to it. Behind a cluster's load
 * balancer the peer is the in-cluster proxy, and trusting `uniquelocal` there
 * means trusting all of 10.0.0.0/8 — every pod — so the deployment has to be
 * able to say "this range only". Unset keeps Railway's behaviour unchanged.
 *
 * Validated here, at import, so a typo stops the boot with the entry named
 * rather than surfacing as Express's error about an "invalid IP address".
 */
export function parseTrustedProxies(raw: string | undefined): string[] {
  const entries = (raw ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return [...DEFAULT_TRUSTED_PROXIES];

  const invalid = entries.filter((entry) => !isValidEntry(entry));
  if (invalid.length > 0) {
    throw new Error(
      'TRUSTED_PROXIES entries must be an IP address, a CIDR range other than /0, or one of ' +
        `loopback, linklocal, uniquelocal. Not: ${invalid.join(', ')}`
    );
  }
  return entries;
}

export const TRUSTED_PROXIES: string[] = parseTrustedProxies(env.TRUSTED_PROXIES);
