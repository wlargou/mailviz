/**
 * A page on the loopback host, over http, on any port: what a local Vite dev
 * server or preview presents as its Origin. Anchored at both ends, so
 * `http://localhost:5180.evil.test` and `http://localhost.evil.test:5180` are
 * not it, and no path or other scheme can follow.
 */
const LOOPBACK_DEV_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}$/;

/**
 * Which browser origins count as the app's own — the one rule behind both the
 * Origin check on API writes (`middleware/sameOrigin.ts`) and the one on the
 * WebSocket upgrade (`websocket.ts`), so the two cannot drift apart.
 *
 * In production: exactly CLIENT_URL's origin, scheme, host and port, and
 * nothing else. In development (any NODE_ENV but 'production') that origin and
 * also any http://localhost:<port> or http://127.0.0.1:<port>: a second client
 * on another port — the repo's own preview runs on 5180 while `server/.env`
 * says 5174 — would otherwise have every write and the socket refused, and a
 * loopback origin is a page on the developer's own machine.
 *
 * Takes the Origin header's value as sent; whether a missing header passes is
 * each caller's own decision.
 */
export function appOriginCheck(clientUrl: string, nodeEnv: string): (origin: string) => boolean {
  const own = new URL(clientUrl).origin;
  if (nodeEnv === 'production') {
    return (origin) => origin === own;
  }
  return (origin) => origin === own || LOOPBACK_DEV_ORIGIN.test(origin);
}
