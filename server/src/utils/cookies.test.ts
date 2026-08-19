import { describe, it, expect, afterEach, vi } from 'vitest';
import type { CookieOptions, Response } from 'express';
import { setAuthCookies, clearAuthCookies } from './cookies.js';

/**
 * The session's security properties live entirely in these two functions.
 *
 * Nothing downstream re-checks them: `middleware/auth.ts` and
 * `controllers/authController.ts` hand tokens to `setAuthCookies` and trust the
 * flags it chooses. Drop `httpOnly` and any XSS in the app becomes full account
 * takeover, because the JWT is now readable from `document.cookie`. Drop
 * `secure` and the production session travels in clear over any plain-http hop.
 * Change `sameSite` from `lax` to `none` and every state-changing endpoint is
 * reachable cross-site with the user's cookies attached.
 *
 * None of that breaks a single feature, so only an assertion catches it.
 */

interface RecordedCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

interface RecordedClear {
  name: string;
  options: CookieOptions;
}

function fakeResponse() {
  const set: RecordedCookie[] = [];
  const cleared: RecordedClear[] = [];
  const res = {
    cookie(name: string, value: string, options: CookieOptions) {
      set.push({ name, value, options });
      return res;
    },
    clearCookie(name: string, options: CookieOptions) {
      cleared.push({ name, options });
      return res;
    },
  };
  return { res: res as unknown as Response, set, cleared };
}

function byName(set: RecordedCookie[], name: string): RecordedCookie {
  const found = set.find((c) => c.name === name);
  if (!found) throw new Error(`no cookie named ${name} was set (got: ${set.map((c) => c.name).join(', ')})`);
  return found;
}

afterEach(() => {
  vi.doUnmock('../config/env.js');
  vi.resetModules();
});

describe('setAuthCookies', () => {
  it('sets both tokens, each in its own cookie, without swapping them', () => {
    // A swap compiles and even "works" until the 15-minute access token
    // expires: the refresh endpoint would then be handed an access token and
    // reject it, logging every user out and making the refresh flow untestable
    // in any window shorter than 15 minutes.
    const { res, set } = fakeResponse();

    setAuthCookies(res, 'the-access-token', 'the-refresh-token');

    expect(set.map((c) => c.name)).toEqual(['access_token', 'refresh_token']);
    expect(byName(set, 'access_token').value).toBe('the-access-token');
    expect(byName(set, 'refresh_token').value).toBe('the-refresh-token');
  });

  it('marks both cookies httpOnly so script cannot read the session', () => {
    const { res, set } = fakeResponse();

    setAuthCookies(res, 'a', 'r');

    expect(byName(set, 'access_token').options.httpOnly).toBe(true);
    expect(byName(set, 'refresh_token').options.httpOnly).toBe(true);
  });

  it('keeps sameSite at lax on both cookies', () => {
    // `lax` still allows the Google OAuth top-level redirect back into the app
    // (the reason it is not `strict`) while withholding the cookie from
    // cross-site sub-requests. `none` would attach it to every third-party
    // request the browser makes to this origin.
    const { res, set } = fakeResponse();

    setAuthCookies(res, 'a', 'r');

    expect(byName(set, 'access_token').options.sameSite).toBe('lax');
    expect(byName(set, 'refresh_token').options.sameSite).toBe('lax');
  });

  it('scopes both cookies to the whole origin', () => {
    const { res, set } = fakeResponse();

    setAuthCookies(res, 'a', 'r');

    expect(byName(set, 'access_token').options.path).toBe('/');
    expect(byName(set, 'refresh_token').options.path).toBe('/');
  });

  it('gives the access token a short life and the refresh token a long one', () => {
    // The split is the point of having two tokens: a stolen access token is
    // useless in 15 minutes. Widening this quietly removes that property.
    const { res, set } = fakeResponse();

    setAuthCookies(res, 'a', 'r');

    expect(byName(set, 'access_token').options.maxAge).toBe(15 * 60 * 1000);
    expect(byName(set, 'refresh_token').options.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
    expect(byName(set, 'access_token').options.maxAge).toBeLessThan(
      byName(set, 'refresh_token').options.maxAge as number
    );
  });

  it('leaves secure off outside production so local http development works', () => {
    // NODE_ENV is 'test' here (vitest.config.ts). A cookie marked secure is
    // never stored by a browser on http://localhost, so hardcoding `true`
    // would make it impossible to log in during development.
    const { res, set } = fakeResponse();

    setAuthCookies(res, 'a', 'r');

    expect(byName(set, 'access_token').options.secure).toBe(false);
    expect(byName(set, 'refresh_token').options.secure).toBe(false);
  });

  it('marks both cookies secure in production', async () => {
    // The single most damaging regression available here: without this flag the
    // deployed session cookie is sent over any plain-http request to the
    // origin. `isProduction` is read at module load, so the module is
    // re-imported against a production env rather than mutated.
    vi.resetModules();
    vi.doMock('../config/env.js', () => ({ env: { NODE_ENV: 'production' } }));

    const { setAuthCookies: setInProduction } = await import('./cookies.js');
    const { res, set } = fakeResponse();

    setInProduction(res, 'a', 'r');

    expect(byName(set, 'access_token').options.secure).toBe(true);
    expect(byName(set, 'refresh_token').options.secure).toBe(true);
    // …and the rest of the flags do not quietly change with the environment.
    expect(byName(set, 'refresh_token').options.httpOnly).toBe(true);
    expect(byName(set, 'refresh_token').options.sameSite).toBe('lax');
  });
});

describe('clearAuthCookies', () => {
  it('clears both cookies', () => {
    const { res, cleared } = fakeResponse();

    clearAuthCookies(res);

    expect(cleared.map((c) => c.name)).toEqual(['access_token', 'refresh_token']);
  });

  it('clears them on the same path they were set with', () => {
    // A Set-Cookie deletion only matches a cookie with the same name *and*
    // path. If the two ever diverge, logout returns 200, the browser keeps the
    // old cookie, and the user stays signed in — on a shared machine.
    const setRes = fakeResponse();
    const clearRes = fakeResponse();

    setAuthCookies(setRes.res, 'a', 'r');
    clearAuthCookies(clearRes.res);

    for (const name of ['access_token', 'refresh_token']) {
      const wasSetWith = byName(setRes.set, name).options.path;
      const clearedWith = clearRes.cleared.find((c) => c.name === name)?.options.path;
      expect(clearedWith, `${name} cleared on a different path than it was set on`).toBe(wasSetWith);
    }
  });
});
