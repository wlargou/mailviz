import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertProductionSecrets } from './env.js';

/**
 * The boot guard on production secrets.
 *
 * The fallbacks in env.ts are deliberate — a developer should be able to clone
 * and run. The danger is the same fallback taking effect in production, where
 * `devSecret('mailviz-jwt-dev')` is a sha256 of a string committed to this
 * repository: a deployment missing JWT_SECRET signs every token with a value
 * anyone reading the source can derive, and nothing about the running app looks
 * wrong.
 *
 * These tests manipulate process.env directly rather than the `env` object,
 * because the guard reads process.env — checking the resolved value would pass
 * against the fallback, which is the whole failure being guarded against.
 */

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

const PUBLIC_URLS = {
  CLIENT_URL: 'https://hub.example.com',
  GOOGLE_REDIRECT_URI: 'https://hub.example.com/api/v1/auth/google/callback',
};

const SECRETS = {
  JWT_SECRET: 'a-real-secret',
  JWT_REFRESH_SECRET: 'a-different-real-secret',
  TOKEN_ENCRYPTION_KEY: 'ff'.repeat(32),
};

/** Production with public URLs unless a test says otherwise. */
function productionWith(vars: Record<string, string | undefined>) {
  process.env = { ...saved, NODE_ENV: 'production', ...PUBLIC_URLS, ...vars };
}

describe('assertProductionSecrets', () => {
  it('does nothing outside production, so local development still runs', () => {
    process.env = { ...saved, NODE_ENV: 'development' };
    delete process.env.JWT_SECRET;

    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it.each(['JWT_SECRET', 'JWT_REFRESH_SECRET', 'TOKEN_ENCRYPTION_KEY'])(
    'refuses to start in production without %s',
    (name) => {
      productionWith({
        JWT_SECRET: 'a-real-secret',
        JWT_REFRESH_SECRET: 'a-different-real-secret',
        TOKEN_ENCRYPTION_KEY: 'ff'.repeat(32),
        [name]: undefined,
      });

      expect(() => assertProductionSecrets()).toThrow(new RegExp(name));
    }
  );

  it('names every missing variable at once rather than one per restart', () => {
    productionWith({
      JWT_SECRET: undefined,
      JWT_REFRESH_SECRET: undefined,
      TOKEN_ENCRYPTION_KEY: undefined,
    });

    // Reporting them one at a time turns a single misconfiguration into three
    // deploy cycles.
    expect(() => assertProductionSecrets()).toThrow(
      /JWT_SECRET, JWT_REFRESH_SECRET, TOKEN_ENCRYPTION_KEY/
    );
  });

  it('refuses two identical JWT secrets', () => {
    // Identical secrets make a 7-day refresh token usable wherever a
    // 15-minute access token is; the `type` claim is the second line of
    // defence, not the first.
    productionWith({
      JWT_SECRET: 'same-value',
      JWT_REFRESH_SECRET: 'same-value',
      TOKEN_ENCRYPTION_KEY: 'ff'.repeat(32),
    });

    expect(() => assertProductionSecrets()).toThrow(/must differ/);
  });

  it('passes when production is configured properly', () => {
    productionWith({
      JWT_SECRET: 'a-real-secret',
      JWT_REFRESH_SECRET: 'a-different-real-secret',
      TOKEN_ENCRYPTION_KEY: 'ff'.repeat(32),
    });

    expect(() => assertProductionSecrets()).not.toThrow();
  });
});

describe('assertProductionSecrets — the public addresses', () => {
  /**
   * CLIENT_URL and GOOGLE_REDIRECT_URI fall back to localhost. On a new host,
   * forgetting one sends Google's sign-in redirect, or the app's own redirect
   * after it, to the user's machine — which looks like Google being broken,
   * not like a missing variable.
   */
  it.each(['CLIENT_URL', 'GOOGLE_REDIRECT_URI'])('refuses to start in production without %s', (name) => {
    productionWith({ ...SECRETS, [name]: undefined });

    expect(() => assertProductionSecrets()).toThrow(new RegExp(`${name} unset or on localhost`));
  });

  it.each([
    'http://localhost:5174',
    'http://127.0.0.1:3002/api/v1/auth/google/callback',
    'http://[::1]:5174',
    'http://hub.localhost:5174',
    'http://0.0.0.0:3002',
    'hub.example.com',
  ])('refuses %s as CLIENT_URL', (value) => {
    productionWith({ ...SECRETS, CLIENT_URL: value });

    expect(() => assertProductionSecrets()).toThrow(/CLIENT_URL unset or on localhost/);
  });

  it('accepts a host that merely contains "localhost"', () => {
    productionWith({ ...SECRETS, CLIENT_URL: 'https://localhost-free.example.com' });

    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it('names a missing secret and a local address in the same error', () => {
    productionWith({ ...SECRETS, JWT_SECRET: undefined, GOOGLE_REDIRECT_URI: 'http://localhost:3002/cb' });

    expect(() => assertProductionSecrets()).toThrow(/JWT_SECRET[\s\S]*GOOGLE_REDIRECT_URI/);
  });

  it('leaves development on its localhost defaults', () => {
    process.env = { ...saved, NODE_ENV: 'development', ...SECRETS, CLIENT_URL: undefined, GOOGLE_REDIRECT_URI: undefined };

    expect(() => assertProductionSecrets()).not.toThrow();
  });
});

/**
 * dotenv 17's `config()` prints a line every time it loads — "injected env (N)
 * from .env", with a rotating advert — unless passed `{ quiet: true }`. It went
 * into the app's container log at every boot. (`dotenv/config`, which
 * prisma.config.ts imports, is quiet by default; its test is here so that it
 * stays that way.) These load the real dotenv.
 */
describe('loading the configuration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('env.ts loads .env without printing anything', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules();

    await import('./env.js');

    expect(log.mock.calls).toEqual([]);
  });

  it('prisma.config.ts loads .env without printing anything', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules();

    // Outside src/, so outside tsconfig's rootDir: imported by URL, untyped.
    const configUrl = new URL('../../prisma.config.ts', import.meta.url).href;
    await import(/* @vite-ignore */ configUrl);

    expect(log.mock.calls).toEqual([]);
  });
});
