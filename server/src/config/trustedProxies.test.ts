import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';
import { TRUSTED_PROXIES, CLOUDFLARE_RANGES, parseTrustedProxies } from './trustedProxies.js';

/**
 * Who the app believes the client is.
 *
 * This decides the rate limiter's bucket, so getting it wrong fails in one of
 * two ways and they pull in opposite directions:
 *
 *  - Too strict (the old state, no `trust proxy` at all) and every request
 *    keys on Railway's internal proxy — one bucket for the whole internet, so
 *    anyone can exhaust it and lock the owner out of signing in.
 *  - Too loose (`trust proxy: true`) and Express believes the LEFTMOST
 *    X-Forwarded-For entry, which the client writes. Rate limiting becomes
 *    opt-out: a fresh fake IP per request and no bucket ever fills.
 *
 * So the spoofing cases below matter more than the happy path. Supertest
 * connects over loopback, which is a trusted hop, so the walk through
 * X-Forwarded-For behaves as it does in production.
 */
function appWithTrust() {
  const app = express();
  app.set('trust proxy', TRUSTED_PROXIES);
  app.get('/who', (req, res) => { res.json({ ip: req.ip }); });
  return app;
}

const ip = async (forwardedFor?: string) => {
  const req = request(appWithTrust()).get('/who');
  if (forwardedFor) req.set('X-Forwarded-For', forwardedFor);
  return (await req).body.ip;
};

describe('trusted proxies', () => {
  it('reads the client through a Cloudflare edge', async () => {
    // The mailviz.rkube.io path: Cloudflare fronts Railway, so the chain the
    // app sees is `client, cf-edge`. 162.158.0.0/15 is a published CF range.
    expect(await ip('203.0.113.5, 162.158.1.1')).toBe('203.0.113.5');
  });

  it('reads the client on the direct Railway path', async () => {
    // The Railway domain is publicly reachable and does NOT pass through
    // Cloudflare, so Railway appends the real client and there is no CF hop.
    expect(await ip('203.0.113.5')).toBe('203.0.113.5');
  });

  it('ignores a forged entry to the left of the real client', async () => {
    // The attack `trust proxy: true` enables: prepend a fake IP and get a
    // fresh rate-limit bucket every request. The walk stops at the first
    // untrusted address from the right, so the fake is never reached.
    expect(await ip('9.9.9.9, 203.0.113.5')).toBe('203.0.113.5');
  });

  it('ignores a forged entry even when it names a Cloudflare range', async () => {
    // Claiming to be Cloudflare does not make you a trusted hop — position in
    // the chain is what counts, and this one is left of the real client.
    expect(await ip('162.158.9.9, 203.0.113.5')).toBe('203.0.113.5');
  });

  it('does not treat a bare client-supplied header as authoritative', async () => {
    // Someone hitting the app directly with only a forged header. Loopback is
    // trusted here, so this is the strictest case the test harness can pose:
    // whatever it resolves to must not be a value the request invented twice.
    expect(await ip('9.9.9.9, 8.8.8.8')).toBe('8.8.8.8');
  });

  it('falls back to the peer when there is no forwarding header', async () => {
    expect(await ip()).toMatch(/127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/);
  });

  it('trusts Railway’s CGNAT hop, which is what production actually peers from', async () => {
    // Measured in production: `::ffff:100.64.0.9`. If this range were not
    // trusted the walk would stop immediately and every user would share it.
    expect(TRUSTED_PROXIES).toContain('100.64.0.0/10');
  });

  it('is a list, never `true`', async () => {
    // `true` is the failure mode this file exists to avoid, and it is one
    // careless edit away.
    expect(Array.isArray(TRUSTED_PROXIES)).toBe(true);
    expect(TRUSTED_PROXIES as unknown).not.toBe(true);
    expect(TRUSTED_PROXIES.length).toBeGreaterThan(5);
  });

  it('carries both IPv4 and IPv6 Cloudflare ranges', async () => {
    // Cloudflare fronts over both; missing v6 would silently coarsen the key
    // for every visitor on an IPv6 connection.
    expect(CLOUDFLARE_RANGES.some((r) => r.includes(':'))).toBe(true);
    expect(CLOUDFLARE_RANGES.some((r) => /^\d+\.\d+\.\d+\.\d+\//.test(r))).toBe(true);
  });
});

/**
 * The point of all of the above: separate rate-limit buckets per client.
 *
 * Asserted through `X-RateLimit-Remaining` rather than by exhausting a bucket,
 * because 20 requests would leak into whatever ran next and a limiter poisoned
 * by its own test is worse than no test.
 */
describe('rate limiting keys on the real client', () => {
  function limitedApp() {
    const app = express();
    app.set('trust proxy', TRUSTED_PROXIES);
    app.use(rateLimit({ windowMs: 60_000, max: 20 }));
    app.get('/x', (_req, res) => { res.send('ok'); });
    return app;
  }

  const remainingFor = async (app: express.Express, forwardedFor: string) => {
    const res = await request(app).get('/x').set('X-Forwarded-For', forwardedFor);
    return Number(res.headers['x-ratelimit-remaining']);
  };

  it('gives two different clients their own budget', async () => {
    // Before `trust proxy`, both requests keyed on Railway's proxy address and
    // the second saw a budget the first had already spent.
    const app = limitedApp();

    const first = await remainingFor(app, '203.0.113.5, 162.158.1.1');
    const second = await remainingFor(app, '198.51.100.9, 162.158.1.1');

    expect(first).toBe(second);
  });

  it('spends one budget when the same client returns', async () => {
    // The other half — otherwise "separate buckets" could be satisfied by a
    // limiter that never counts anything at all.
    const app = limitedApp();

    const first = await remainingFor(app, '203.0.113.5, 162.158.1.1');
    const again = await remainingFor(app, '203.0.113.5, 162.158.1.1');

    expect(again).toBe(first - 1);
  });

  it('does not let a forged prefix mint a fresh budget', async () => {
    // The attack: vary the leftmost entry per request and never fill a bucket.
    // The real client is the rightmost untrusted hop, so both of these are the
    // same client and share one budget.
    const app = limitedApp();

    const first = await remainingFor(app, '1.1.1.1, 203.0.113.5');
    const second = await remainingFor(app, '2.2.2.2, 203.0.113.5');

    expect(second).toBe(first - 1);
  });
});

/**
 * TRUSTED_PROXIES from the environment.
 *
 * Behind a cluster's load balancer the peer is the in-cluster proxy, and the
 * built-in `uniquelocal` trusts all of 10.0.0.0/8 — every pod on the cluster —
 * so a deployment has to be able to name its proxy's range and nothing else.
 * Unset, Railway must behave exactly as it does today.
 */
describe('TRUSTED_PROXIES from the environment', () => {
  const TODAY = [
    'loopback',
    'linklocal',
    'uniquelocal',
    '100.64.0.0/10',
    ...CLOUDFLARE_RANGES,
  ];

  it.each([undefined, '', '  ', ' , '])('keeps today’s list exactly when unset (%j)', (raw) => {
    expect(parseTrustedProxies(raw)).toEqual(TODAY);
  });

  it('is today’s list in this process, where the variable is unset', () => {
    expect(TRUSTED_PROXIES).toEqual(TODAY);
  });

  it('is what the variable says when it is set at boot', async () => {
    const saved = process.env.TRUSTED_PROXIES;
    process.env.TRUSTED_PROXIES = '10.244.0.0/16';
    try {
      vi.resetModules();
      const fresh = await import('./trustedProxies.js');
      expect(fresh.TRUSTED_PROXIES).toEqual(['10.244.0.0/16']);
    } finally {
      if (saved === undefined) delete process.env.TRUSTED_PROXIES;
      else process.env.TRUSTED_PROXIES = saved;
    }
  });

  it('replaces the list rather than adding to it', () => {
    expect(parseTrustedProxies(' 10.244.0.0/16 , fd00:10::/64,loopback ')).toEqual([
      '10.244.0.0/16',
      'fd00:10::/64',
      'loopback',
    ]);
  });

  it('stops believing a hop that is no longer on the list', async () => {
    // The replacement is what makes it useful: with only the proxy's range
    // trusted, a request whose peer is anything else — here loopback — keys
    // on that peer, whatever X-Forwarded-For says.
    const app = express();
    app.set('trust proxy', parseTrustedProxies('10.244.0.0/16'));
    app.get('/who', (req, res) => { res.json({ ip: req.ip }); });

    const res = await request(app).get('/who').set('X-Forwarded-For', '203.0.113.5');

    expect(res.body.ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('refuses the boot on anything Express would not read as a hop, naming each one', () => {
    expect(() => parseTrustedProxies('10.0.0.0/8, true, 10.0.0.0/33, proxy.internal, 10.0.0.0/8/1, ::/129'))
      .toThrow(/Not: true, 10\.0\.0\.0\/33, proxy\.internal, 10\.0\.0\.0\/8\/1, ::\/129$/);
  });

  it.each(['0.0.0.0/0', '::/0'])('refuses %s, which trusts every address', (range) => {
    // A /0 is `trust proxy: true` by another name: every hop is believed, so
    // the client's own leftmost X-Forwarded-For entry becomes its address.
    expect(() => parseTrustedProxies(range)).toThrow(/TRUSTED_PROXIES/);
  });
});
