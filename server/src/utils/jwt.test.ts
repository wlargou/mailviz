import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './jwt.js';
import { env } from '../config/env.js';

/**
 * Access/refresh token signing and verification.
 *
 * The security property worth a test is the *separation* of the two token
 * types. Access tokens live 15 minutes and travel on every request; refresh
 * tokens live 7 days and mint new access tokens. If the two were ever signed
 * with the same secret, a stolen access token could be replayed against the
 * refresh endpoint and silently upgraded into week-long access — the short
 * access lifetime, which is the whole point of the split, would buy nothing.
 *
 * Two things enforce the separation: distinct secrets, and the `type` claim.
 * Both are checked here, because collapsing JWT_SECRET and JWT_REFRESH_SECRET
 * onto one value (easy to do while wiring up environments) leaves the code
 * compiling, the tests for the happy path passing, and the boundary gone.
 */
describe('access tokens', () => {
  it('round-trips the user id and token type', () => {
    const payload = verifyAccessToken(signAccessToken('user-123'));

    expect(payload.sub).toBe('user-123');
    expect(payload.type).toBe('access');
  });

  it('rejects a token signed with the wrong secret', () => {
    const foreign = jwt.sign({ sub: 'user-123', type: 'access' }, 'not-the-real-secret');

    expect(() => verifyAccessToken(foreign)).toThrow();
  });

  it('rejects a tampered payload', () => {
    const token = signAccessToken('user-123');
    const [header, payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'attacker', type: 'access' }))
      .toString('base64url');

    expect(header && payload && signature).toBeTruthy();
    expect(() => verifyAccessToken(`${header}.${forged}.${signature}`)).toThrow();
  });

  it('rejects garbage', () => {
    expect(() => verifyAccessToken('not-a-jwt')).toThrow();
    expect(() => verifyAccessToken('')).toThrow();
  });

  it('rejects an expired token', () => {
    // Signed directly so the expiry is in the past without waiting 15 minutes
    // or freezing the clock; the secret is the real one, so only `exp` differs
    // from a token the app would have issued.
    const expired = jwt.sign({ sub: 'user-123', type: 'access' }, env.JWT_SECRET, {
      expiresIn: '-1s',
    });

    expect(() => verifyAccessToken(expired)).toThrow(jwt.TokenExpiredError);
  });
});

describe('refresh tokens', () => {
  it('round-trips the user id and token type', () => {
    const payload = verifyRefreshToken(signRefreshToken('user-456'));

    expect(payload.sub).toBe('user-456');
    expect(payload.type).toBe('refresh');
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ sub: 'user-456', type: 'refresh' }, env.JWT_REFRESH_SECRET, {
      expiresIn: '-1s',
    });

    expect(() => verifyRefreshToken(expired)).toThrow(jwt.TokenExpiredError);
  });
});

describe('access and refresh tokens are not interchangeable', () => {
  it('an access token does not verify as a refresh token — REGRESSION', () => {
    // If this ever passes, JWT_SECRET and JWT_REFRESH_SECRET have converged and
    // a leaked access token can be traded for 7 days of access.
    const access = signAccessToken('user-123');

    expect(() => verifyRefreshToken(access)).toThrow();
  });

  it('a refresh token does not verify as an access token', () => {
    const refresh = signRefreshToken('user-123');

    expect(() => verifyAccessToken(refresh)).toThrow();
  });

  it('carries a type claim so the two remain distinguishable after verification', () => {
    // Belt and braces: even if the secrets were unified, callers can still tell
    // the tokens apart — but only if this claim is present on both.
    expect(verifyAccessToken(signAccessToken('u')).type).toBe('access');
    expect(verifyRefreshToken(signRefreshToken('u')).type).toBe('refresh');
  });

  it('signs the two token types with different secrets', () => {
    expect(env.JWT_SECRET).not.toBe(env.JWT_REFRESH_SECRET);
  });
});
