import { describe, it, expect, afterEach } from 'vitest';
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

function productionWith(vars: Record<string, string | undefined>) {
  process.env = { ...saved, NODE_ENV: 'production', ...vars };
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
