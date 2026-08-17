import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../utils/encryption.js';
import { createUser, createGoogleAuth } from '../test/factories.js';
import { googleAuthService } from './googleAuthService.js';

/**
 * Storing Google's tokens after the OAuth callback.
 *
 * Google returns a refresh token only when the request forced consent — which
 * for an app the account has already authorised means *not* on an ordinary
 * login. The type said `refreshToken: string` and the exchange asserted it with
 * `!`, so on those logins `undefined` reached `encrypt()` and threw, and the
 * whole sign-in came back as INTERNAL_ERROR.
 */

const TOKENS = {
  accessToken: 'access-token-value',
  refreshToken: 'refresh-token-value',
  expiryDate: Date.now() + 3_600_000,
};

describe('googleAuthService.upsertGoogleAuth', () => {
  it('stores both tokens on a first connection', async () => {
    const user = await createUser();

    await googleAuthService.upsertGoogleAuth(user.id, TOKENS);

    const auth = await prisma.googleAuth.findUnique({ where: { userId: user.id } });
    expect(decrypt(auth!.accessToken)).toBe('access-token-value');
    expect(decrypt(auth!.refreshToken)).toBe('refresh-token-value');
  });

  it('keeps the stored refresh token when Google omits one — REGRESSION', async () => {
    const user = await createUser();
    await googleAuthService.upsertGoogleAuth(user.id, TOKENS);

    // An ordinary re-login: a fresh access token, no refresh token.
    await googleAuthService.upsertGoogleAuth(user.id, {
      accessToken: 'second-access-token',
      expiryDate: Date.now() + 3_600_000,
    });

    const auth = await prisma.googleAuth.findUnique({ where: { userId: user.id } });
    expect(decrypt(auth!.accessToken)).toBe('second-access-token');
    // Blanking this would be worse than the crash: the account could never
    // refresh again, and the failure would surface hours later as a dead sync.
    expect(decrypt(auth!.refreshToken)).toBe('refresh-token-value');
  });

  it('refuses a first connection with no refresh token, so the caller can force consent', async () => {
    const user = await createUser();

    await expect(
      googleAuthService.upsertGoogleAuth(user.id, {
        accessToken: 'access-only',
        expiryDate: Date.now() + 3_600_000,
      })
    ).rejects.toMatchObject({ code: 'GOOGLE_REFRESH_TOKEN_MISSING' });

    // Nothing half-written.
    expect(await prisma.googleAuth.findUnique({ where: { userId: user.id } })).toBeNull();
  });

  it('does not touch another account tokens', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await googleAuthService.upsertGoogleAuth(alice.id, TOKENS);
    await googleAuthService.upsertGoogleAuth(bob.id, { ...TOKENS, refreshToken: 'bob-refresh' });

    await googleAuthService.upsertGoogleAuth(alice.id, {
      accessToken: 'alice-new',
      expiryDate: Date.now() + 3_600_000,
    });

    const bobAuth = await prisma.googleAuth.findUnique({ where: { userId: bob.id } });
    expect(decrypt(bobAuth!.refreshToken)).toBe('bob-refresh');
  });
});

describe('googleAuthService.getAuthUrl', () => {
  it('forces consent for an account with no Google connection — REGRESSION', async () => {
    const connected = await createUser();
    await createGoogleAuth(connected.id);
    const newcomer = await createUser();

    const url = await googleAuthService.getAuthUrl('login', newcomer.id);

    // The check used to be an unscoped `findFirst()`, so one connected account
    // anywhere in the database meant every later login asked only to pick an
    // account — and Google answers that without a refresh token.
    expect(url).toContain('prompt=consent');
  });

  it('does not force consent for an account that is already connected', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    const url = await googleAuthService.getAuthUrl('login', user.id);

    expect(url).toContain('prompt=select_account');
  });

  it('forces consent when asked, which is the callback recovery path', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    const url = await googleAuthService.getAuthUrl('login', user.id, { forceConsent: true });

    expect(url).toContain('prompt=consent');
  });

  it('always forces consent when connecting, so every scope is re-granted', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    const url = await googleAuthService.getAuthUrl('connect', user.id);

    expect(url).toContain('prompt=consent');
  });

  it('requests offline access, without which no refresh token is ever issued', async () => {
    const user = await createUser();
    const url = await googleAuthService.getAuthUrl('login', user.id);
    expect(url).toContain('access_type=offline');
  });
});
