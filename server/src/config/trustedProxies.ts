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

export const TRUSTED_PROXIES: string[] = [
  'loopback',
  'linklocal',
  'uniquelocal',
  RAILWAY_INTERNAL,
  ...CLOUDFLARE_RANGES,
];
