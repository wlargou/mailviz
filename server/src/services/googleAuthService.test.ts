import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { google } from 'googleapis';
import { prisma } from '../lib/prisma.js';
import { decrypt, encrypt } from '../utils/encryption.js';
import {
  createUser,
  createTwoUsers,
  createGoogleAuth,
  createCustomer,
  createContact,
  createEmail,
  createTask,
} from '../test/factories.js';
import { INVALID_GRANT, tokenEndpointError, tokenEndpointUnreachable } from '../test/googleRefusal.js';
import { googleAuthService, SCOPES } from './googleAuthService.js';

// Only so the `google:auth` pushes can be watched; nothing here opens a socket.
const ws = vi.hoisted(() => ({ wsEmitToUser: vi.fn() }));
vi.mock('../websocket.js', () => ({ wsEmitToUser: ws.wsEmitToUser, wsEmit: vi.fn(), wsEmitToUsers: vi.fn() }));

beforeEach(() => {
  ws.wsEmitToUser.mockClear();
});

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

  it('stores the scopes Google granted, not the ones it was asked for — REGRESSION', async () => {
    const user = await createUser();
    // The user unticked Gmail on the consent screen.
    const granted = SCOPES.filter((s) => !s.endsWith('gmail.modify')).join(' ');

    await googleAuthService.upsertGoogleAuth(user.id, { ...TOKENS, scope: granted });

    // This used to write `SCOPES.join(' ')` whatever came back, so the
    // connection read as complete and every Gmail call 403'd.
    const auth = await prisma.googleAuth.findUnique({ where: { userId: user.id } });
    expect(auth!.scope).toBe(granted);
  });

  it('clears a refused grant on a reconnect, which brings a new refresh token', async () => {
    const user = await createUser();
    await googleAuthService.upsertGoogleAuth(user.id, TOKENS);
    await prisma.googleAuth.update({
      where: { userId: user.id },
      data: { authError: 'invalid_grant', authErrorAt: new Date() },
    });

    await googleAuthService.upsertGoogleAuth(user.id, { ...TOKENS, refreshToken: 'new-grant' });

    const auth = await prisma.googleAuth.findUnique({ where: { userId: user.id } });
    expect(auth!.authError).toBeNull();
    expect(ws.wsEmitToUser).toHaveBeenCalledWith(user.id, 'google:auth', { authError: null });
  });

  it('keeps a refused grant through a login that brought no refresh token', async () => {
    const user = await createUser();
    await googleAuthService.upsertGoogleAuth(user.id, TOKENS);
    await prisma.googleAuth.update({
      where: { userId: user.id },
      data: { authError: 'invalid_grant', authErrorAt: new Date() },
    });

    // An ordinary sign-in: a fresh access token, and the dead refresh token
    // still stored. Clearing here would hide the warning until the next tick
    // put it back, on every login.
    await googleAuthService.upsertGoogleAuth(user.id, { accessToken: 'login-access', expiryDate: Date.now() + 3_600_000 });

    const auth = await prisma.googleAuth.findUnique({ where: { userId: user.id } });
    expect(auth!.authError).toBe('invalid_grant');
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

/**
 * The stored connection, once the OAuth dance is over: refreshing it, handing it
 * out, and tearing it down.
 *
 * Everything below shares one hazard. `getAuthenticatedClient`, `getStatus` and
 * `disconnect` all begin with `findFirst({ where: userId ? { userId } : {} })`,
 * and that empty-object branch is a live footgun — the same shape already
 * shipped once in `getAuthUrl`, where an unscoped `findFirst()` asked whether
 * *anybody* had connected Google. Here the blast radius is larger: an unscoped
 * read hands one account another account's Gmail credentials, and an unscoped
 * delete empties another account's mailbox.
 */

/** A Google connection with tokens stored the way the callback stores them. */
async function connectGoogle(
  userId: string,
  overrides: Partial<{ accessToken: string; refreshToken: string; tokenExpiry: Date }> = {}
) {
  return prisma.googleAuth.create({
    data: {
      userId,
      accessToken: encrypt(overrides.accessToken ?? 'stored-access'),
      refreshToken: encrypt(overrides.refreshToken ?? 'stored-refresh'),
      tokenExpiry: overrides.tokenExpiry ?? new Date(Date.now() + 60 * 60_000),
      email: `google-${userId}@example.com`,
    },
  });
}

/** What `oauth2Client.refreshAccessToken()` resolves to, minus the transport bits. */
interface RefreshResult {
  credentials: { access_token?: string; refresh_token?: string; expiry_date?: number };
}

/**
 * Substitute Google's token endpoint.
 *
 * `createOAuth2Client()` is module-private and builds a fresh client per call,
 * so the prototype is the only seam. Without it these tests would make a real
 * HTTPS request to accounts.google.com.
 */
function stubRefresh(impl: () => Promise<RefreshResult>) {
  vi.spyOn(google.auth.OAuth2.prototype, 'refreshAccessToken').mockImplementation(impl);
}

const HOUR = 60 * 60_000;

describe('googleAuthService.getAuthenticatedClient', () => {
  beforeEach(() => {
    // Default: no token endpoint. A test that wants a refresh stubs it itself,
    // and any test that refreshes unexpectedly fails loudly instead of dialling
    // out to Google.
    stubRefresh(async () => {
      throw new Error('refreshAccessToken called without a stub');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for an account that has not connected Google, even when another has — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    await connectGoogle(bob.id, { accessToken: 'bob-access', refreshToken: 'bob-refresh' });

    // Drop the `userId ?` guard on the where and this returns Bob's client:
    // Alice's mail sync would then read and label Bob's mailbox.
    expect(await googleAuthService.getAuthenticatedClient(alice.id)).toBeNull();
  });

  it('returns null when nothing is connected, so callers can surface "not connected"', async () => {
    const user = await createUser();
    expect(await googleAuthService.getAuthenticatedClient(user.id)).toBeNull();
  });

  it('persists a refreshed access token encrypted, not in the clear', async () => {
    const user = await createUser();
    // Five minutes of life left — inside the ten-minute proactive window.
    const auth = await connectGoogle(user.id, { tokenExpiry: new Date(Date.now() + 5 * 60_000) });
    const newExpiry = Date.now() + HOUR;
    stubRefresh(async () => ({
      credentials: { access_token: 'fresh-access', expiry_date: newExpiry },
    }));

    const client = await googleAuthService.getAuthenticatedClient(user.id);
    expect(client).not.toBeNull();

    const row = await prisma.googleAuth.findUnique({ where: { id: auth.id } });
    expect(decrypt(row!.accessToken)).toBe('fresh-access');
    expect(row!.tokenExpiry.getTime()).toBe(newExpiry);
    // The column is the thing TOKEN_ENCRYPTION_KEY exists to protect. Writing the
    // raw token here would put a live Gmail credential in every database dump.
    expect(row!.accessToken).not.toBe('fresh-access');
  });

  it('keeps the stored refresh token when the refresh response omits one', async () => {
    const user = await createUser();
    const auth = await connectGoogle(user.id, { tokenExpiry: new Date(Date.now() + 5 * 60_000) });
    stubRefresh(async () => ({
      credentials: { access_token: 'fresh-access', expiry_date: Date.now() + HOUR },
    }));

    await googleAuthService.getAuthenticatedClient(user.id);

    const row = await prisma.googleAuth.findUnique({ where: { id: auth.id } });
    expect(decrypt(row!.accessToken)).toBe('fresh-access');
    // Google only re-sends a refresh token when it rotates one. Writing whatever
    // came back unconditionally blanks the column, and an account with no refresh
    // token is permanently dead an hour later — with no error at the time.
    expect(decrypt(row!.refreshToken)).toBe('stored-refresh');
  });

  it('stores a rotated refresh token when Google issues one', async () => {
    const user = await createUser();
    const auth = await connectGoogle(user.id, { tokenExpiry: new Date(Date.now() + 5 * 60_000) });
    stubRefresh(async () => ({
      credentials: {
        access_token: 'fresh-access',
        refresh_token: 'rotated-refresh',
        expiry_date: Date.now() + HOUR,
      },
    }));

    await googleAuthService.getAuthenticatedClient(user.id);

    const row = await prisma.googleAuth.findUnique({ where: { id: auth.id } });
    // Ignoring a rotation leaves the old refresh token stored; Google stops
    // honouring it and the connection dies at the next refresh.
    expect(decrypt(row!.refreshToken)).toBe('rotated-refresh');
  });

  it('refreshes only the calling account row', async () => {
    const { alice, bob } = await createTwoUsers();
    await connectGoogle(alice.id, { tokenExpiry: new Date(Date.now() + 5 * 60_000) });
    const bobAuth = await connectGoogle(bob.id, {
      accessToken: 'bob-access',
      refreshToken: 'bob-refresh',
    });
    stubRefresh(async () => ({
      credentials: { access_token: 'alice-fresh', expiry_date: Date.now() + HOUR },
    }));

    await googleAuthService.getAuthenticatedClient(alice.id);

    const row = await prisma.googleAuth.findUnique({ where: { id: bobAuth.id } });
    expect(decrypt(row!.accessToken)).toBe('bob-access');
    expect(decrypt(row!.refreshToken)).toBe('bob-refresh');
  });

  it('leaves a healthy token alone', async () => {
    const user = await createUser();
    const auth = await connectGoogle(user.id, { tokenExpiry: new Date(Date.now() + HOUR) });
    const refresh = vi.spyOn(google.auth.OAuth2.prototype, 'refreshAccessToken');

    await googleAuthService.getAuthenticatedClient(user.id);

    // Refreshing on every call burns Google's token quota and, with several
    // background schedulers running per user, invalidates tokens mid-flight.
    expect(refresh).not.toHaveBeenCalled();
    const row = await prisma.googleAuth.findUnique({ where: { id: auth.id } });
    expect(decrypt(row!.accessToken)).toBe('stored-access');
  });

  it('refreshes on demand for a long operation even when the token looks healthy', async () => {
    const user = await createUser();
    const auth = await connectGoogle(user.id, { tokenExpiry: new Date(Date.now() + HOUR) });
    stubRefresh(async () => ({
      credentials: { access_token: 'forced-fresh', expiry_date: Date.now() + HOUR },
    }));

    // A full mail sync outlives an hour-long token, which is what forceRefresh
    // is for: start it with a token good for the whole run.
    await googleAuthService.getAuthenticatedClient(user.id, true);

    const row = await prisma.googleAuth.findUnique({ where: { id: auth.id } });
    expect(decrypt(row!.accessToken)).toBe('forced-fresh');
  });

  it('still returns a client when the grant has been revoked, and records why', async () => {
    const user = await createUser();
    const auth = await connectGoogle(user.id, { tokenExpiry: new Date(Date.now() + 5 * 60_000) });
    const refused = await tokenEndpointError(400, INVALID_GRANT);
    stubRefresh(async () => {
      throw refused;
    });

    // A user who removed the app in their Google account settings must not take
    // down the scheduler for everyone: the refresh failure is swallowed here and
    // the account is skipped where the API call fails.
    const client = await googleAuthService.getAuthenticatedClient(user.id);
    expect(client).not.toBeNull();

    const row = await prisma.googleAuth.findUnique({ where: { id: auth.id } });
    expect(decrypt(row!.accessToken)).toBe('stored-access');
    expect(decrypt(row!.refreshToken)).toBe('stored-refresh');
    // Swallowed, but no longer silently: this is what Settings reads. Before,
    // the account showed Connected for as long as anyone cared to look.
    expect(row!.authError).toBe('invalid_grant');
    expect(row!.authErrorAt).toBeInstanceOf(Date);
  });

  it('does not record the refusal when a Reconnect lands during the refresh', async () => {
    const user = await createUser();
    await connectGoogle(user.id, { tokenExpiry: new Date(Date.now() + 5 * 60_000) });
    const refused = await tokenEndpointError(400, INVALID_GRANT);
    stubRefresh(async () => {
      // The consent callback stores the new grant while Google is still
      // answering for the old one.
      await googleAuthService.upsertGoogleAuth(user.id, { ...TOKENS, refreshToken: 'new-grant' });
      throw refused;
    });

    await googleAuthService.getAuthenticatedClient(user.id);

    const row = await prisma.googleAuth.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decrypt(row.refreshToken)).toBe('new-grant');
    expect(row.authError).toBeNull();
  });

  it('leaves the stored refresh token as stored when the refresh only echoes it back', async () => {
    const user = await createUser();
    const auth = await connectGoogle(user.id, { tokenExpiry: new Date(Date.now() + 5 * 60_000) });
    // What google-auth-library really returns: the refresh token it was given,
    // whether or not Google rotated it.
    stubRefresh(async () => ({
      credentials: { access_token: 'fresh-access', refresh_token: 'stored-refresh', expiry_date: Date.now() + HOUR },
    }));

    await googleAuthService.getAuthenticatedClient(user.id);

    // Re-encrypted, the same token is new ciphertext every hour, and a refusal
    // compared against the grant a sync started with would be dropped as
    // belonging to a grant that no longer exists.
    const row = await prisma.googleAuth.findUniqueOrThrow({ where: { id: auth.id } });
    expect(decrypt(row.accessToken)).toBe('fresh-access');
    expect(row.refreshToken).toBe(auth.refreshToken);
  });

  it.each([
    ['a 500', () => tokenEndpointError(500, { error: 'backend_error' })],
    ['a 429', () => tokenEndpointError(429, { error: 'rate_limit_exceeded' })],
    ['a dropped connection', () => tokenEndpointUnreachable()],
  ])('does not mark the grant dead for %s', async (_label, failure) => {
    const user = await createUser();
    const auth = await connectGoogle(user.id, { tokenExpiry: new Date(Date.now() + 5 * 60_000) });
    const err = await failure();
    stubRefresh(async () => {
      throw err;
    });

    await googleAuthService.getAuthenticatedClient(user.id);

    // Google having a bad minute is not the user's grant dying. Recording it
    // would tell a working account to reconnect, every time.
    const row = await prisma.googleAuth.findUnique({ where: { id: auth.id } });
    expect(row!.authError).toBeNull();
    expect(ws.wsEmitToUser).not.toHaveBeenCalled();
  });

  it('clears a recorded refusal once a refresh succeeds', async () => {
    const user = await createUser();
    const auth = await connectGoogle(user.id, { tokenExpiry: new Date(Date.now() + 5 * 60_000) });
    await prisma.googleAuth.update({
      where: { id: auth.id },
      data: { authError: 'invalid_grant', authErrorAt: new Date('2026-10-17T08:00:00Z') },
    });
    stubRefresh(async () => ({
      credentials: { access_token: 'fresh-access', expiry_date: Date.now() + HOUR },
    }));

    await googleAuthService.getAuthenticatedClient(user.id);

    // Google answered, so the grant works: leaving the error in place would
    // keep the warning up after the user fixed it.
    const row = await prisma.googleAuth.findUnique({ where: { id: auth.id } });
    expect(row!.authError).toBeNull();
    expect(row!.authErrorAt).toBeNull();
    expect(ws.wsEmitToUser).toHaveBeenCalledWith(user.id, 'google:auth', { authError: null });
  });

  it('records the refusal on the calling account only', async () => {
    const { alice, bob } = await createTwoUsers();
    await connectGoogle(alice.id, { tokenExpiry: new Date(Date.now() + 5 * 60_000) });
    const bobAuth = await connectGoogle(bob.id);
    const refused = await tokenEndpointError(400, INVALID_GRANT);
    stubRefresh(async () => {
      throw refused;
    });

    await googleAuthService.getAuthenticatedClient(alice.id);

    const bobRow = await prisma.googleAuth.findUnique({ where: { id: bobAuth.id } });
    expect(bobRow!.authError).toBeNull();
    expect(ws.wsEmitToUser).not.toHaveBeenCalledWith(bob.id, expect.anything(), expect.anything());
  });

  it('clears the calling account only', async () => {
    const { alice, bob } = await createTwoUsers();
    await connectGoogle(alice.id, { tokenExpiry: new Date(Date.now() + 5 * 60_000) });
    const bobAuth = await connectGoogle(bob.id);
    await prisma.googleAuth.updateMany({
      where: { userId: { in: [alice.id, bob.id] } },
      data: { authError: 'invalid_grant', authErrorAt: new Date() },
    });
    stubRefresh(async () => ({
      credentials: { access_token: 'alice-fresh', expiry_date: Date.now() + HOUR },
    }));

    await googleAuthService.getAuthenticatedClient(alice.id);

    // Bob's grant is still dead; Alice's refresh says nothing about it.
    const bobRow = await prisma.googleAuth.findUnique({ where: { id: bobAuth.id } });
    expect(bobRow!.authError).toBe('invalid_grant');
  });

  it('stores the scopes a refresh reports, correcting a row from before they were kept', async () => {
    const user = await createUser();
    const auth = await connectGoogle(user.id, { tokenExpiry: new Date(Date.now() + 5 * 60_000) });
    // What every row written before 1.29.3 holds: the list the app asked for.
    await prisma.googleAuth.update({ where: { id: auth.id }, data: { scope: SCOPES.join(' ') } });
    const granted = SCOPES.filter((s) => !s.endsWith('gmail.modify')).join(' ');
    stubRefresh(async () => ({
      credentials: { access_token: 'fresh-access', expiry_date: Date.now() + HOUR, scope: granted },
    }));

    await googleAuthService.getAuthenticatedClient(user.id);

    const row = await prisma.googleAuth.findUnique({ where: { id: auth.id } });
    expect(row!.scope).toBe(granted);
  });

  it('persists tokens Google hands back mid-operation', async () => {
    const user = await createUser();
    const auth = await connectGoogle(user.id, { tokenExpiry: new Date(Date.now() + HOUR) });
    const client = await googleAuthService.getAuthenticatedClient(user.id);

    // google-auth-library emits this when it renews a token during a request.
    // Nothing else writes it back, so dropping the listener means the renewed
    // token is used for one process lifetime and lost on restart.
    client!.emit('tokens', { access_token: 'mid-flight', expiry_date: Date.now() + HOUR });

    await vi.waitFor(async () => {
      const row = await prisma.googleAuth.findUnique({ where: { id: auth.id } });
      expect(decrypt(row!.accessToken)).toBe('mid-flight');
    });
  });

  it('clears a recorded refusal when Google renews a token mid-operation', async () => {
    const user = await createUser();
    const auth = await connectGoogle(user.id, { tokenExpiry: new Date(Date.now() + HOUR) });
    await prisma.googleAuth.update({
      where: { id: auth.id },
      data: { authError: 'invalid_grant', authErrorAt: new Date() },
    });
    const client = await googleAuthService.getAuthenticatedClient(user.id);

    // The library refreshing on its own is as much a working grant as the
    // proactive refresh above, and the only one a long sync goes through.
    client!.emit('tokens', { access_token: 'mid-flight', expiry_date: Date.now() + HOUR });

    await vi.waitFor(async () => {
      const row = await prisma.googleAuth.findUnique({ where: { id: auth.id } });
      expect(row!.authError).toBeNull();
    });
  });
});

describe('googleAuthService.recordAuthError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs and announces a refusal once, however often it is seen', async () => {
    const user = await createUser();
    const auth = await connectGoogle(user.id);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await googleAuthService.recordAuthError(user.id, 'invalid_grant', auth.refreshToken)).toBe(true);
    const first = await prisma.googleAuth.findUniqueOrThrow({ where: { userId: user.id } });
    expect(await googleAuthService.recordAuthError(user.id, 'invalid_grant', auth.refreshToken)).toBe(false);

    // Every tick of two schedulers sees the same dead grant. One line, one
    // push, and the time it started — not the time it was last seen.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(ws.wsEmitToUser).toHaveBeenCalledTimes(1);
    expect(ws.wsEmitToUser).toHaveBeenCalledWith(user.id, 'google:auth', {
      authError: { code: 'invalid_grant', at: first.authErrorAt },
    });
    const second = await prisma.googleAuth.findUniqueOrThrow({ where: { userId: user.id } });
    expect(second.authErrorAt).toEqual(first.authErrorAt);
  });

  it('records a different refusal as a change', async () => {
    const user = await createUser();
    const auth = await connectGoogle(user.id);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await googleAuthService.recordAuthError(user.id, 'invalid_grant', auth.refreshToken);
    expect(await googleAuthService.recordAuthError(user.id, 'unauthorized_client', auth.refreshToken)).toBe(true);

    const row = await prisma.googleAuth.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.authError).toBe('unauthorized_client');
  });

  it('does not record a refusal of a grant a Reconnect has since replaced — REGRESSION', async () => {
    const user = await createUser();
    await connectGoogle(user.id);
    // What a sync read when it started: the old grant, about to be refused.
    const refusedGrant = await googleAuthService.currentGrant(user.id);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // The user reconnects while that sync's request is in flight.
    await googleAuthService.upsertGoogleAuth(user.id, { ...TOKENS, refreshToken: 'new-grant' });
    ws.wsEmitToUser.mockClear();

    // Unconditional, this put the error back over the new grant, and nothing
    // that succeeds clears it until the next token refresh — "Sync has
    // stopped" for most of an hour, just after the user fixed it.
    expect(await googleAuthService.recordAuthError(user.id, 'invalid_grant', refusedGrant!)).toBe(false);

    const row = await prisma.googleAuth.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.authError).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(ws.wsEmitToUser).not.toHaveBeenCalled();
  });
});

describe('googleAuthService.currentGrant', () => {
  it('is the caller’s stored refresh token, as stored, and null without a connection', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceAuth = await connectGoogle(alice.id, { refreshToken: 'alice-refresh' });
    await connectGoogle(bob.id, { refreshToken: 'bob-refresh' });
    const nobody = await createUser();

    // Ciphertext, compared with the column — never decrypted to be compared.
    expect(await googleAuthService.currentGrant(alice.id)).toBe(aliceAuth.refreshToken);
    expect(await googleAuthService.currentGrant(nobody.id)).toBeNull();
  });
});

describe('googleAuthService.noteAuthFailure', () => {
  beforeEach(() => {
    stubRefresh(async () => {
      throw new Error('refreshAccessToken called without a stub');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** What Gmail answers once the grant behind an unexpired access token is revoked. */
  const revokedAccessToken = () =>
    Object.assign(new Error('Request had invalid authentication credentials.'), {
      status: 401,
      response: { status: 401, data: { error: { code: 401, status: 'UNAUTHENTICATED' } } },
    });

  it('records a refusal and reports it handled', async () => {
    const user = await createUser();
    const { refreshToken: grant } = await connectGoogle(user.id);

    expect(await googleAuthService.noteAuthFailure(user.id, await tokenEndpointError(400, INVALID_GRANT), grant)).toBe(true);

    const row = await prisma.googleAuth.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.authError).toBe('invalid_grant');
  });

  it('asks the token endpoint about a 401, and records its refusal', async () => {
    const user = await createUser();
    const { refreshToken: grant } = await connectGoogle(user.id);
    const refused = await tokenEndpointError(400, INVALID_GRANT);
    const refresh = vi.spyOn(google.auth.OAuth2.prototype, 'refreshAccessToken').mockImplementation(async () => {
      throw refused;
    });

    // google-auth-library does not refresh on a 401 when the expiry is known,
    // so without the probe a revoked grant surfaced only at the next proactive
    // refresh — up to fifty minutes of mail not arriving with Settings content.
    expect(await googleAuthService.noteAuthFailure(user.id, revokedAccessToken(), grant)).toBe(true);

    expect(refresh).toHaveBeenCalledTimes(1);
    const row = await prisma.googleAuth.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.authError).toBe('invalid_grant');
  });

  it('leaves a 401 to the caller when the grant refreshes fine', async () => {
    const user = await createUser();
    const { refreshToken: grant } = await connectGoogle(user.id);
    stubRefresh(async () => ({
      credentials: { access_token: 'fresh-access', expiry_date: Date.now() + HOUR },
    }));

    expect(await googleAuthService.noteAuthFailure(user.id, revokedAccessToken(), grant)).toBe(false);

    const row = await prisma.googleAuth.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.authError).toBeNull();
  });

  it('does not probe, or record, any other failure', async () => {
    const user = await createUser();
    const { refreshToken: grant } = await connectGoogle(user.id);
    const refresh = vi.spyOn(google.auth.OAuth2.prototype, 'refreshAccessToken');

    expect(await googleAuthService.noteAuthFailure(user.id, await tokenEndpointError(500, { error: 'x' }), grant)).toBe(false);
    expect(await googleAuthService.noteAuthFailure(user.id, await tokenEndpointUnreachable(), grant)).toBe(false);

    expect(refresh).not.toHaveBeenCalled();
    const row = await prisma.googleAuth.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.authError).toBeNull();
  });
});

describe('googleAuthService.disconnect', () => {
  beforeEach(() => {
    // Revoking hits Google over the network and the service already treats a
    // failure as fine, so fail it rather than dial out.
    vi.spyOn(google.auth.OAuth2.prototype, 'revokeToken').mockImplementation(async () => {
      throw new Error('revoke unavailable in tests');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Everything a Google connection puts in the database for one account. */
  async function seedSyncedData(userId: string) {
    const customer = await createCustomer(userId);
    const contact = await createContact(customer.id);
    const email = await createEmail(userId, { customerId: customer.id });
    // Both of these hang off the email. They are deleted explicitly, before the
    // emails, and until they existed here the suite could not tell whether
    // those two statements were load-bearing or dead — the FKs cascade, so
    // removing them from the transaction was invisible.
    const attachment = await prisma.emailAttachment.create({
      data: {
        emailId: email.id,
        gmailAttachmentId: `att-${userId.slice(0, 8)}`,
        filename: 'invoice.pdf',
        mimeType: 'application/pdf',
        size: 1024,
      },
    });
    // `googleEventId` set deliberately: this fixture stands for data that came
    // FROM Google, and without it the row is one Google never had — which the
    // disconnect now keeps. The assertion below would then have been passing
    // for the wrong reason, certifying a bug while claiming to test synced-data
    // deletion.
    const event = await prisma.calendarEvent.create({
      data: {
        userId,
        googleEventId: 'g-synced-1',
        title: 'Standup',
        startTime: new Date('2026-08-20T09:00:00.000Z'),
        endTime: new Date('2026-08-20T09:15:00.000Z'),
      },
    });
    const task = await createTask(userId);
    await prisma.task.update({ where: { id: task.id }, data: { customerId: customer.id } });
    const mailToTask = await prisma.mailToTask.create({
      data: { emailId: email.id, taskId: task.id },
    });
    return { customer, contact, email, event, task, attachment, mailToTask };
  }

  it('removes the Google connection for that account only', async () => {
    const { alice, bob } = await createTwoUsers();
    await connectGoogle(alice.id);
    await connectGoogle(bob.id);

    await googleAuthService.disconnect(alice.id);

    expect(await prisma.googleAuth.findUnique({ where: { userId: alice.id } })).toBeNull();
    expect(await prisma.googleAuth.findUnique({ where: { userId: bob.id } })).not.toBeNull();
  });

  it('deletes the synced data of the account that disconnected', async () => {
    const user = await createUser();
    await connectGoogle(user.id);
    const data = await seedSyncedData(user.id);

    // Both relations cascade from `emails`, so their rows disappear whether or
    // not the transaction deletes them explicitly — which is why removing both
    // statements was invisible to every assertion below. Watching the calls is
    // the only way to observe them, and it pins the part that actually went
    // wrong once: the `userId` scoping.
    const deleteLinks = vi.spyOn(prisma.mailToTask, 'deleteMany');
    const deleteAttachments = vi.spyOn(prisma.emailAttachment, 'deleteMany');

    await googleAuthService.disconnect(user.id);

    expect(deleteLinks).toHaveBeenCalledWith({ where: { email: { userId: user.id } } });
    expect(deleteAttachments).toHaveBeenCalledWith({ where: { email: { userId: user.id } } });

    expect(await prisma.email.findUnique({ where: { id: data.email.id } })).toBeNull();
    expect(await prisma.calendarEvent.findUnique({ where: { id: data.event.id } })).toBeNull();

    // Rows that hang off an email or a company are gone too — but note these
    // pass via ON DELETE CASCADE, so they cannot tell whether the transaction's
    // explicit deletes ran. That is what the spies above are for; these pin the
    // cascade itself, which is what would break if a migration ever changed one
    // of those FKs to Restrict.
    expect(await prisma.emailAttachment.findUnique({ where: { id: data.attachment.id } })).toBeNull();
    expect(await prisma.mailToTask.findUnique({ where: { id: data.mailToTask.id } })).toBeNull();
    expect(await prisma.customer.findUnique({ where: { id: data.customer.id } })).toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: data.contact.id } })).toBeNull();
    // Tasks are the user's own work, not synced data — they survive, unlinked.
    const task = await prisma.task.findUnique({ where: { id: data.task.id } });
    expect(task).not.toBeNull();
    expect(task!.customerId).toBeNull();
  });

  it('leaves every other account synced data untouched — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    await connectGoogle(alice.id);
    await connectGoogle(bob.id);
    const aliceData = await seedSyncedData(alice.id);
    const bobData = await seedSyncedData(bob.id);

    await googleAuthService.disconnect(alice.id);

    expect(await prisma.email.findUnique({ where: { id: aliceData.email.id } })).toBeNull();

    // Every deleteMany in the transaction ran with an empty `where`, so one user
    // pressing "Disconnect Google" wiped every other user's mailbox, calendar,
    // contacts and companies — and unlinked their tasks — with no way back short
    // of a restore plus a full re-sync.
    expect(await prisma.email.findUnique({ where: { id: bobData.email.id } })).not.toBeNull();
    expect(await prisma.calendarEvent.findUnique({ where: { id: bobData.event.id } })).not.toBeNull();
    expect(await prisma.customer.findUnique({ where: { id: bobData.customer.id } })).not.toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: bobData.contact.id } })).not.toBeNull();
    const bobTask = await prisma.task.findUnique({ where: { id: bobData.task.id } });
    expect(bobTask!.customerId).toBe(bobData.customer.id);
  });

  it('is a no-op for an account that never connected Google — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    await connectGoogle(bob.id);
    const bobData = await seedSyncedData(bob.id);

    // Alice has nothing to disconnect. An unscoped lookup would find Bob's row,
    // and the delete would then be aimed at his account.
    await expect(googleAuthService.disconnect(alice.id)).resolves.toBeUndefined();

    expect(await prisma.googleAuth.findUnique({ where: { userId: bob.id } })).not.toBeNull();
    expect(await prisma.email.findUnique({ where: { id: bobData.email.id } })).not.toBeNull();
  });
});

describe('googleAuthService.getStatus', () => {
  it('reports not connected for an account with no connection, even when another has one', async () => {
    const { alice, bob } = await createTwoUsers();
    await createGoogleAuth(bob.id);

    // The banner this drives is what tells a new user to connect Google at all.
    expect(await googleAuthService.getStatus(alice.id)).toEqual({ connected: false });
  });

  it('reports the connected account own address', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'connected@example.com' });

    const status = await googleAuthService.getStatus(user.id);

    expect(status.connected).toBe(true);
    expect(status.email).toBe('connected@example.com');
  });

  it('does not ask a fully-scoped connection to reconnect', async () => {
    const user = await createUser();
    const auth = await createGoogleAuth(user.id, { email: 'connected@example.com' });
    await prisma.googleAuth.update({
      where: { id: auth.id },
      data: { scope: SCOPES.join(' ') },
    });

    const status = await googleAuthService.getStatus(user.id);

    // The other half of the scope check. Without it `needsReauth = true`
    // hardcoded passes the whole file, and the banner never goes away.
    expect(status.needsReauth).toBe(false);
  });

  it('flags a connection that predates a scope the app now needs', async () => {
    const user = await createUser();
    const auth = await createGoogleAuth(user.id);
    // A connection made before gmail.modify was added to SCOPES.
    await prisma.googleAuth.update({
      where: { id: auth.id },
      data: { scope: 'https://www.googleapis.com/auth/calendar' },
    });

    const status = await googleAuthService.getStatus(user.id);

    // Without this the app looks connected and every Gmail call 403s.
    expect(status.needsReauth).toBe(true);
  });

  it('flags a grant whose scopes lack gmail.modify', async () => {
    const user = await createUser();
    const auth = await createGoogleAuth(user.id);
    await prisma.googleAuth.update({
      where: { id: auth.id },
      data: { scope: SCOPES.filter((s) => !s.endsWith('gmail.modify')).join(' ') },
    });

    expect((await googleAuthService.getStatus(user.id)).needsReauth).toBe(true);
  });

  it('does not take a narrower scope for the one required', async () => {
    const user = await createUser();
    const auth = await createGoogleAuth(user.id);
    // `calendar.readonly` contains `calendar` as a string. The old substring
    // check passed it; a read-only grant cannot write an event.
    await prisma.googleAuth.update({
      where: { id: auth.id },
      data: {
        scope: SCOPES.map((s) => (s.endsWith('/calendar') ? `${s}.readonly` : s)).join(' '),
      },
    });

    expect((await googleAuthService.getStatus(user.id)).needsReauth).toBe(true);
  });

  it('accepts the short names Google may answer with for email and profile', async () => {
    const user = await createUser();
    const auth = await createGoogleAuth(user.id);
    await prisma.googleAuth.update({
      where: { id: auth.id },
      data: {
        scope: [
          'openid',
          'email',
          'profile',
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/gmail.modify',
        ].join(' '),
      },
    });

    expect((await googleAuthService.getStatus(user.id)).needsReauth).toBe(false);
  });

  it('does not flag a row written before scopes were stored', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    // A null scope is how every early connection reads. Treating it as
    // "nothing granted" would put every one of them behind a reconnect banner.
    const status = await googleAuthService.getStatus(user.id);
    expect(status.needsReauth).toBe(false);
    expect(status.authError).toBeNull();
  });

  it('reports a refused grant, and asks for a reconnect even with every scope', async () => {
    const user = await createUser();
    const auth = await createGoogleAuth(user.id);
    const at = new Date('2026-10-17T08:00:00.000Z');
    await prisma.googleAuth.update({
      where: { id: auth.id },
      data: { scope: SCOPES.join(' '), authError: 'invalid_grant', authErrorAt: at },
    });

    const status = await googleAuthService.getStatus(user.id);

    // The state this whole change exists for: the scopes are all there, the
    // grant is dead, and the page used to say Connected.
    expect(status.needsReauth).toBe(true);
    expect(status.authError).toEqual({ code: 'invalid_grant', at });
  });

  it('reports only the caller’s refused grant', async () => {
    const { alice, bob } = await createTwoUsers();
    await createGoogleAuth(alice.id);
    const bobAuth = await createGoogleAuth(bob.id);
    await prisma.googleAuth.update({
      where: { id: bobAuth.id },
      data: { authError: 'invalid_grant', authErrorAt: new Date() },
    });

    const status = await googleAuthService.getStatus(alice.id);

    expect(status.authError).toBeNull();
    expect(status.needsReauth).toBe(false);
  });
});

describe('googleAuthService.disconnect — what is the user’s own', () => {
  /**
   * Step 1 of the same transaction keeps the user's tasks, saying they are
   * "the user's own work, not synced data". An event created here that never
   * reached Google passes exactly that test — Google has never seen it, so
   * unlinking Google is no reason to destroy it. It was being deleted anyway.
   */
  it('keeps an event Google never had, and deletes the ones it did', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    const mine = await prisma.calendarEvent.create({
      data: {
        userId: user.id,
        googleEventId: null,
        title: 'Written here, never pushed',
        startTime: new Date('2026-08-20T09:00:00.000Z'),
        endTime: new Date('2026-08-20T10:00:00.000Z'),
      },
    });
    const synced = await prisma.calendarEvent.create({
      data: {
        userId: user.id,
        googleEventId: 'g-from-google',
        title: 'Came from Google',
        startTime: new Date('2026-08-21T09:00:00.000Z'),
        endTime: new Date('2026-08-21T10:00:00.000Z'),
      },
    });

    await googleAuthService.disconnect(user.id);

    // Both halves matter. Keeping everything would be just as wrong as
    // keeping nothing, and a test asserting only the survivor would pass.
    expect(await prisma.calendarEvent.findUnique({ where: { id: mine.id } })).not.toBeNull();
    expect(await prisma.calendarEvent.findUnique({ where: { id: synced.id } })).toBeNull();
  });

  it('clears a pending marker on the events it keeps', async () => {
    // Nothing will ever push them again: the retry sweep enumerates accounts
    // from GoogleAuth, which this transaction deletes. A marker left behind
    // would age into a permanent "no longer retrying" warning about an event
    // the user deliberately took out of Google.
    const user = await createUser();
    await createGoogleAuth(user.id);
    const kept = await prisma.calendarEvent.create({
      data: {
        userId: user.id,
        googleEventId: null,
        title: 'Never pushed',
        startTime: new Date('2026-08-20T09:00:00.000Z'),
        endTime: new Date('2026-08-20T10:00:00.000Z'),
        pendingSince: new Date('2026-08-19T00:00:00.000Z'),
      },
    });

    await googleAuthService.disconnect(user.id);

    const row = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: kept.id } });
    expect(row.pendingSince).toBeNull();
  });

  it('does not reach another account’s local events', async () => {
    const { alice, bob } = await createTwoUsers();
    await createGoogleAuth(alice.id);
    await createGoogleAuth(bob.id);
    const theirs = await prisma.calendarEvent.create({
      data: {
        userId: bob.id,
        googleEventId: null,
        title: 'Bob wrote this',
        startTime: new Date('2026-08-20T09:00:00.000Z'),
        endTime: new Date('2026-08-20T10:00:00.000Z'),
      },
    });

    await googleAuthService.disconnect(alice.id);

    expect(await prisma.calendarEvent.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });
});

