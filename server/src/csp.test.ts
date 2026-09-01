import { describe, it, expect } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { cspOptions } from './app.js';

/**
 * The production Content-Security-Policy.
 *
 * This is tested through a real helmet instance rather than by asserting on the
 * options object, because the bug was never in the object — it was in what
 * helmet's *defaults* emit when you do not override them. Only the rendered
 * header shows that.
 *
 * The suite runs as NODE_ENV=test, where CSP is off, so nothing else in it can
 * reach this branch. That is exactly how the original defect survived: the
 * policy applies only on the deployed app, and images looked fine on the
 * machine the code was written on.
 */
async function csp(nodeEnv: string): Promise<string | undefined> {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: cspOptions(nodeEnv) }));
  app.get('/', (_req, res) => { res.send('ok'); });
  const res = await request(app).get('/');
  return res.headers['content-security-policy'];
}

describe('production CSP', () => {
  it('allows remote images so mail bodies render', async () => {
    // Helmet's default is `img-src 'self' data:`, which blocks every hosted
    // image in every message — signatures, newsletters, anything not inlined.
    const header = await csp('production');

    expect(header).toBeDefined();
    expect(header).toContain("img-src 'self' data: https:");
  });

  it('does not relax anything that can execute', async () => {
    // The whole point of relaxing img-src only. If a later edit widens these,
    // a hostile message body stops being inert.
    const header = await csp('production');

    expect(header).toContain("script-src 'self'");
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("default-src 'self'");
    expect(header).not.toContain("script-src 'self' https:");
    expect(header).not.toContain("'unsafe-eval'");
  });

  it('keeps the rest of the default policy rather than replacing it', async () => {
    // Naming one directive must not drop the others. `useDefaults: true` is
    // stated explicitly, but it is also helmet's default — removing it changes
    // nothing, which this test was checked against. What it actually guards is
    // a future edit switching to `useDefaults: false`, where naming img-src
    // alone would silently delete frame-ancestors, base-uri and the rest.
    const header = await csp('production');

    expect(header).toContain('frame-ancestors');
    expect(header).toContain('base-uri');
  });

  it('stays off outside production', async () => {
    // Vite serves the client in development, so a CSP here would only ever
    // block the dev server's own inline module preloads.
    expect(await csp('development')).toBeUndefined();
    expect(await csp('test')).toBeUndefined();
  });
});
