import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sameOriginWrites } from './sameOrigin.js';
import { errorHandler } from './errorHandler.js';
import { app } from '../app.js';
import { env } from '../config/env.js';

/**
 * The Origin check on state-changing API requests.
 *
 * SameSite=Lax kept other sites' pages from spending the session cookies on a
 * POST. Under a registrable domain shared with other apps, every sibling
 * subdomain is the same site and Lax lets their requests through; Origin is
 * what still tells this app's own page from theirs.
 *
 * Two halves: the rule itself, on a bare app, and that the real app applies it
 * to /api ahead of every route — a check mounted after the routers, or on the
 * wrong prefix, passes the first half and protects nothing.
 *
 * The rule has two modes. In production only CLIENT_URL's origin is the app's;
 * in development a loopback page on any port is too, so a second local client
 * (the preview on 5180, with CLIENT_URL still saying 5174) can save.
 */

const APP = 'https://app.example.test';
const SIBLING = 'https://studio.example.test';

/** Loopback pages a local Vite dev server or preview presents as their Origin. */
const LOOPBACK = ['http://localhost:5180', 'http://127.0.0.1:5180', 'http://localhost:3000'];

function bare(nodeEnv = 'production') {
  const a = express();
  // A trailing path, to prove the rule compares origins rather than strings.
  a.use('/api', sameOriginWrites(`${APP}/some/path`, nodeEnv));
  a.all('/api/thing', (_req, res) => {
    res.json({ ok: true });
  });
  a.use(errorHandler);
  return a;
}

describe('sameOriginWrites, in production', () => {
  it('refuses a POST from another origin, in the usual error shape', async () => {
    const res = await request(bare()).post('/api/thing').set('Origin', SIBLING);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Cross-origin request refused' } });
  });

  it.each(['put', 'patch', 'delete'] as const)('refuses a cross-origin %s', async (method) => {
    const res = await request(bare())[method]('/api/thing').set('Origin', SIBLING);

    expect(res.status).toBe(403);
  });

  it("lets the app's own origin through", async () => {
    const res = await request(bare()).post('/api/thing').set('Origin', APP);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('lets a request with no Origin through', async () => {
    // curl, scripts, server-to-server: nothing that holds a victim's cookies.
    const res = await request(bare()).post('/api/thing');

    expect(res.status).toBe(200);
  });

  it.each(['get', 'head', 'options'] as const)('leaves a cross-origin %s alone', async (method) => {
    const res = await request(bare())[method]('/api/thing').set('Origin', SIBLING);

    expect(res.status).toBe(200);
  });

  it('compares the whole origin — scheme, host and port', async () => {
    for (const origin of [
      'http://app.example.test', // the same host over http
      'https://app.example.test:8443',
      `${APP}.evil.test`, // a prefix match would let this through
      'null', // what a sandboxed frame or a file:// page sends
    ]) {
      const res = await request(bare()).post('/api/thing').set('Origin', origin);
      expect({ origin, status: res.status }).toEqual({ origin, status: 403 });
    }
  });

  it('refuses loopback pages: development has no say in production', async () => {
    for (const origin of LOOPBACK) {
      const res = await request(bare('production')).post('/api/thing').set('Origin', origin);
      expect({ origin, status: res.status }).toEqual({ origin, status: 403 });
    }
  });
});

describe('sameOriginWrites, in development', () => {
  // Anything but 'production' is development — the test runner's 'test' included.
  it.each(['development', 'test'])("lets a loopback page on any port write (NODE_ENV=%s)", async (nodeEnv) => {
    for (const origin of LOOPBACK) {
      const res = await request(bare(nodeEnv)).post('/api/thing').set('Origin', origin);
      expect({ origin, status: res.status }).toEqual({ origin, status: 200 });
    }
  });

  it("still lets CLIENT_URL's own origin write", async () => {
    const res = await request(bare('development')).post('/api/thing').set('Origin', APP);

    expect(res.status).toBe(200);
  });

  it('refuses everything else, as in production', async () => {
    for (const origin of [
      SIBLING,
      'https://localhost:5180', // loopback, but not over http
      'http://localhost:5180.evil.test', // a prefix match would let these through
      'http://localhost.evil.test:5180',
      'http://evil.localhost:5180',
      'http://localhost:5180/path', // never a real Origin, and not one to accept
      'null',
    ]) {
      const res = await request(bare('development')).post('/api/thing').set('Origin', origin);
      expect({ origin, status: res.status }).toEqual({ origin, status: 403 });
    }
  });
});

describe('the app', () => {
  const OWN = new URL(env.CLIENT_URL).origin;

  it('checks Origin before any route runs', async () => {
    // Logout requires a session, so a request that reached it would be a 401.
    // A 403 is the check answering first.
    const res = await request(app).post('/api/v1/auth/logout').set('Origin', SIBLING);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("lets the client's own requests reach the routes", async () => {
    // In production the page and the API share an origin; in development the
    // Vite proxy forwards the page's Origin untouched (it rewrites Host only),
    // and CLIENT_URL is the page's address in both.
    const own = await request(app).post('/api/v1/auth/logout').set('Origin', OWN);
    const none = await request(app).post('/api/v1/auth/logout');

    expect(own.status).toBe(401);
    expect(none.status).toBe(401);
  });

  it('does not stand in the way of the Google callback', async () => {
    // A GET, arriving from Google's pages. Without a code it is turned back to
    // the login page — by the route, not refused by the check.
    const res = await request(app)
      .get('/api/v1/auth/google/callback')
      .set('Origin', 'https://accounts.google.com');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${env.CLIENT_URL}/login?error=missing_code`);
  });

  it('leaves reads alone whatever their origin', async () => {
    const res = await request(app).get('/api/version').set('Origin', SIBLING);

    expect(res.status).toBe(200);
  });

  it('applies the development rule outside production', async () => {
    // The suite runs with NODE_ENV=test: a loopback page on a port CLIENT_URL
    // does not name reaches the route, as the 5180 preview's writes must.
    const preview = 'http://localhost:5180';
    expect(preview).not.toBe(OWN); // or this would pass on CLIENT_URL alone

    const res = await request(app).post('/api/v1/auth/logout').set('Origin', preview);

    expect(res.status).toBe(401);
  });
});

describe('the app, built for production', () => {
  // NODE_ENV is read when app.ts builds its middleware, so the production app
  // is a fresh import under a production environment, not the one above.
  const PROD_CLIENT_URL = 'https://mailviz.example.test';

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function productionApp() {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CLIENT_URL', PROD_CLIENT_URL);
    vi.resetModules();
    return (await import('../app.js')).app;
  }

  it("accepts CLIENT_URL's origin and nothing on loopback", async () => {
    const prod = await productionApp();

    const own = await request(prod).post('/api/v1/auth/logout').set('Origin', PROD_CLIENT_URL);
    expect(own.status).toBe(401);

    for (const origin of LOOPBACK) {
      const res = await request(prod).post('/api/v1/auth/logout').set('Origin', origin);
      expect({ origin, status: res.status }).toEqual({ origin, status: 403 });
    }
  });
});
