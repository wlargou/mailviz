import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { gmail_v1 } from 'googleapis';
import jwt from 'jsonwebtoken';

import { app } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { getGmailClient } from '../lib/gmail.js';
import { signAccessToken, signRefreshToken } from '../utils/jwt.js';
import {
  createUser,
  createTwoUsers,
  createEmail,
  createDraft,
  createTask,
  createGoogleAuth,
  createCustomer,
  shareThreadWith,
} from '../test/factories.js';
import { createGmailMock, type GmailMock } from '../test/gmailMock.js';
import { isSyncInProgressFor } from '../jobs/emailSyncScheduler.js';

/**
 * Route-level smoke tests for the mail domain: `/api/v1/auth` and
 * `/api/v1/emails` (drafts, scheduled sends and thread sharing included).
 *
 * Everything else in this suite tests services, which take `userId` as a
 * parameter and trust it. That leaves a hole exactly the width of a
 * controller: a handler that forwards the wrong id — `req.params.id` where it
 * meant `req.user.id`, `aid` and `id` transposed, a route mounted outside
 * `requireAuth` — leaks another tenant's mail and no service test notices,
 * because at the service layer the caller was already lying about who it was.
 *
 * So these tests drive the real Express app over a real socket, with real
 * cookies, and assert three things per route:
 *
 *   1. no cookie → 401. This is the check that the route is actually behind
 *      `requireAuth`. It is asserted for every single protected route, in one
 *      table, because "somebody added a route to the router and it happened to
 *      land on the public side of the mount" is a mistake that produces no
 *      symptom until it is a breach.
 *   2. a valid cookie → the documented status and body *shape*. The client
 *      reads `{ data }` off nearly everything, and three of these routes
 *      deliberately do not follow that convention — pinning them stops a
 *      well-meant "consistency" refactor from silently breaking the UI.
 *   3. someone else's id → 404, and the record is untouched. This is the
 *      highest-value assertion here.
 *
 * Gmail is replaced at `lib/gmail.ts#getGmailClient`, the single seam every
 * Gmail call in the app goes through.
 */

vi.mock('../lib/gmail.js', () => ({ getGmailClient: vi.fn() }));

// Only the status probe is stubbed; the scheduler itself is covered in
// jobs/schedulers.test.ts. Real in-flight sync state is unreachable from a
// route test, and without a stub the route can only ever answer `false`.
vi.mock('../jobs/emailSyncScheduler.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs/emailSyncScheduler.js')>()),
  isSyncInProgressFor: vi.fn(() => false),
}));

// ── HTTP harness ─────────────────────────────────────────────────────────────

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

interface ApiError {
  code?: string;
  message?: string;
  details?: unknown;
}

/** The union of every response body shape these routes produce. */
interface ApiBody {
  data?: unknown;
  meta?: unknown;
  error?: ApiError;
  success?: boolean;
  signature?: string | null;
  message?: string;
  uncategorized?: unknown;
}

interface ApiResult {
  status: number;
  body: ApiBody;
  text: string;
  headers: Headers;
}

interface RequestOptions {
  /** Send the access-token cookie for this user id. */
  as?: string;
  /** Send a raw Cookie header instead (for the token-shape cases). */
  cookie?: string;
  body?: unknown;
}

async function call(method: string, path: string, options: RequestOptions = {}): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (options.as) headers.cookie = `access_token=${signAccessToken(options.as)}`;
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    // The OAuth callback answers with a redirect to CLIENT_URL. Following it
    // would reach the developer's Vite server if one happens to be running,
    // turning a 302 assertion into a 200 depending on what else is up.
    redirect: 'manual',
  });

  const text = await res.text();
  let body: ApiBody = {};
  if ((res.headers.get('content-type') ?? '').includes('application/json') && text) {
    body = JSON.parse(text) as ApiBody;
  }
  return { status: res.status, body, text, headers: res.headers };
}

/** `data` as an array — for the list routes. */
function rows(result: ApiResult): unknown[] {
  expect(Array.isArray(result.body.data)).toBe(true);
  return result.body.data as unknown[];
}

function ids(result: ApiResult): string[] {
  return rows(result).map((row) => (row as { id: string }).id);
}

// ── Gmail seam ───────────────────────────────────────────────────────────────

let gmail: GmailMock;
/**
 * `users.messages.send` is not part of the shared mock (nothing in the service
 * suite sends), so it is added here rather than in `test/gmailMock.ts`. The
 * cast goes through `unknown` for the same reason the shared mock's does: a
 * partial fake is the point.
 */
let messagesSend: Mock;

function extendWithSend(mock: GmailMock): Mock {
  const send = vi.fn().mockResolvedValue({ data: { id: 'sent-msg-1', threadId: 'thread-sent-1' } });
  const messages = mock.client.users.messages as unknown as { send: Mock };
  messages.send = send;
  return send;
}

beforeEach(() => {
  gmail = createGmailMock();
  messagesSend = extendWithSend(gmail);
  vi.mocked(getGmailClient).mockResolvedValue(gmail.client as gmail_v1.Gmail);
});

afterEach(() => {
  vi.mocked(getGmailClient).mockReset();
});

// ── Local fixtures ───────────────────────────────────────────────────────────

/**
 * A Google connection whose stored access token cannot be decrypted.
 *
 * `googleAuthService.disconnect` revokes the token with a real HTTP call to
 * Google before it deletes anything. The revoke sits inside a try/catch along
 * with the `decrypt` that feeds it, so a token that fails to decrypt short-
 * circuits the network call without changing the code path under test.
 */
async function connectGoogleWithUndecryptableToken(userId: string, email: string) {
  const auth = await createGoogleAuth(userId, { email });
  return prisma.googleAuth.update({
    where: { id: auth.id },
    data: { accessToken: 'zz:zz:zz' },
  });
}

async function createAttachment(emailId: string, filename: string) {
  return prisma.emailAttachment.create({
    data: {
      emailId,
      gmailAttachmentId: `gmail-att-${filename}`,
      filename,
      mimeType: 'application/pdf',
      size: 1024,
    },
  });
}

async function createScheduled(userId: string, overrides: { subject?: string; status?: string } = {}) {
  return prisma.scheduledEmail.create({
    data: {
      userId,
      mode: 'new',
      sendAt: new Date(Date.now() + 3_600_000),
      to: ['someone@example.com'],
      subject: overrides.subject ?? 'Scheduled subject',
      htmlBody: '<p>later</p>',
      ...(overrides.status ? { status: overrides.status } : {}),
    },
  });
}

const futureIso = () => new Date(Date.now() + 7_200_000).toISOString();

// ── 1. Every protected route is behind requireAuth ───────────────────────────

/**
 * The full protected surface of the mail domain. A route added to
 * `routes/auth.ts` without `requireAuth`, or a mount moved out from under it in
 * `app.ts`, shows up here as a 200 where a 401 belongs.
 */
const PROTECTED_ROUTES: Array<[method: string, path: string]> = [
  // auth
  ['GET', '/api/v1/auth/me'],
  ['POST', '/api/v1/auth/logout'],
  ['GET', '/api/v1/auth/google/url'],
  ['GET', '/api/v1/auth/google/status'],
  ['POST', '/api/v1/auth/google/disconnect'],
  ['GET', '/api/v1/auth/users'],
  ['GET', '/api/v1/auth/signature'],
  ['PUT', '/api/v1/auth/signature'],
  // emails — reads
  ['GET', '/api/v1/emails'],
  ['GET', '/api/v1/emails/review-summary'],
  ['GET', '/api/v1/emails/unread-count'],
  ['GET', '/api/v1/emails/sync-status'],
  ['GET', '/api/v1/emails/scheduled'],
  ['GET', '/api/v1/emails/drafts'],
  ['GET', '/api/v1/emails/drafts/some-id'],
  ['GET', '/api/v1/emails/threads/some-thread'],
  ['GET', '/api/v1/emails/threads/some-thread/shares'],
  ['GET', '/api/v1/emails/some-id'],
  ['GET', '/api/v1/emails/some-id/attachments/some-attachment'],
  // emails — compose / send
  ['POST', '/api/v1/emails/send'],
  ['POST', '/api/v1/emails/schedule'],
  ['PATCH', '/api/v1/emails/scheduled/some-id'],
  ['DELETE', '/api/v1/emails/scheduled/some-id'],
  ['POST', '/api/v1/emails/some-id/reply'],
  ['POST', '/api/v1/emails/some-id/forward'],
  // emails — drafts
  ['POST', '/api/v1/emails/drafts'],
  ['POST', '/api/v1/emails/drafts/sync'],
  ['PUT', '/api/v1/emails/drafts/some-id'],
  ['DELETE', '/api/v1/emails/drafts/some-id'],
  ['POST', '/api/v1/emails/drafts/some-id/send'],
  // emails — sharing
  ['POST', '/api/v1/emails/threads/some-thread/share'],
  ['DELETE', '/api/v1/emails/threads/some-thread/shares/some-user'],
  // emails — sync + batch
  ['POST', '/api/v1/emails/sync'],
  ['POST', '/api/v1/emails/batch/read'],
  ['POST', '/api/v1/emails/batch/unread'],
  ['POST', '/api/v1/emails/batch/archive'],
  ['POST', '/api/v1/emails/batch/trash'],
  // emails — per-message mutations
  ['PATCH', '/api/v1/emails/some-id/read'],
  ['PATCH', '/api/v1/emails/some-id/unread'],
  ['PATCH', '/api/v1/emails/some-id/star'],
  ['PATCH', '/api/v1/emails/some-id/archive'],
  ['PATCH', '/api/v1/emails/some-id/unarchive'],
  ['PATCH', '/api/v1/emails/some-id/trash'],
  ['PATCH', '/api/v1/emails/some-id/untrash'],
  ['POST', '/api/v1/emails/some-id/convert-to-task'],
];

describe('authentication gate', () => {
  it.each(PROTECTED_ROUTES)('%s %s rejects an anonymous request with 401', async (method, path) => {
    const res = await call(method, path);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('UNAUTHORIZED');
    // Nothing about the resource may leak alongside the rejection.
    expect(res.body.data).toBeUndefined();
  });

  it('leaves the two public auth routes reachable without a cookie', async () => {
    // The login URL and the OAuth callback have to work before a session
    // exists. If a blanket `requireAuth` is ever applied to the auth router,
    // login breaks entirely — and every other test here would still pass.
    const loginUrl = await call('GET', '/api/v1/auth/login/google/url');
    expect(loginUrl.status).toBe(200);
    expect(loginUrl.body.data).toMatchObject({ url: expect.stringContaining('https://') });

    const callback = await call('GET', '/api/v1/auth/google/callback');
    expect(callback.status).toBe(302);
  });

  /**
   * The rate limiter has to cover the route that authenticates, not the one
   * that builds a URL.
   *
   * It was mounted only on `/api/v1/auth/login`, which by prefix reaches
   * `GET /auth/login/google/url` — a handler that returns a redirect target and
   * touches nothing. The callback, which exchanges an OAuth code with Google,
   * writes the user row, mints the session cookies and applies the
   * ALLOWED_EMAILS check, was unlimited.
   *
   * Asserted through the headers rather than by exhausting the bucket: 20
   * requests would leak into every other test in this file that touches an
   * auth route, and a limiter poisoned by its own test is worse than no test.
   */
  it('rate-limits the OAuth callback, not just the login URL', async () => {
    const callback = await call('GET', '/api/v1/auth/google/callback');
    expect(callback.headers.get('x-ratelimit-limit')).not.toBeNull();

    const loginUrl = await call('GET', '/api/v1/auth/login/google/url');
    expect(loginUrl.headers.get('x-ratelimit-limit')).not.toBeNull();

    // The negative half: the header is evidence of a mount, so it has to be
    // absent somewhere, or this asserts nothing about where the limiter is.
    const unlimited = await call('GET', '/api/v1/auth/me');
    expect(unlimited.headers.get('x-ratelimit-limit')).toBeNull();
  });

  it('rejects a token signed with the wrong secret', async () => {
    // The access and refresh secrets are distinct on purpose: a refresh token
    // must not be usable as an access token. Verifying with the wrong key has
    // to fail closed rather than throw a 500 out of the middleware.
    const { alice } = await createTwoUsers();
    const forged = jwt.sign({ sub: alice.id, type: 'access' }, 'not-the-jwt-secret', { expiresIn: '15m' });

    const res = await call('GET', '/api/v1/auth/me', { cookie: `access_token=${forged}` });
    expect(res.status).toBe(401);
  });

  it('rejects a well-formed token for a user that no longer exists', async () => {
    // Deleting a user must end their session. `requireAuth` loads the row
    // rather than trusting the signature alone; dropping that lookup would
    // leave revoked accounts authenticated for the life of their cookie.
    const ghost = await createUser();
    const token = signAccessToken(ghost.id);
    await prisma.user.delete({ where: { id: ghost.id } });

    // NOT /auth/me: `authController.getMe` re-reads the user and 401s on its
    // own, so that route passed this test even with the middleware's database
    // lookup removed entirely. /emails/unread-count has no such second check,
    // and the message pins that the answer came from requireAuth.
    const res = await call('GET', '/api/v1/emails/unread-count', {
      cookie: `access_token=${token}`,
    });
    expect(res.status).toBe(401);
    expect((res.body as { error: { message: string } }).error.message).toBe(
      'Authentication required'
    );
  });

  it('accepts a refresh token alone and mints a fresh access cookie', async () => {
    // The access token lives 15 minutes. Without this fallback every tab would
    // bounce to /login four times an hour.
    const { alice } = await createTwoUsers();
    const res = await call('GET', '/api/v1/auth/me', {
      cookie: `refresh_token=${signRefreshToken(alice.id)}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: alice.id });
    expect(res.headers.getSetCookie().join(';')).toContain('access_token=');
  });
});

// ── 2. /api/v1/auth ──────────────────────────────────────────────────────────

describe('/api/v1/auth — account deletion', () => {
  it('GET /account/summary reports the caller counts and nobody else\'s', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(alice.id);
    await createEmail(alice.id);
    await createEmail(bob.id);
    await createTask(bob.id);

    const res = await call('GET', '/api/v1/auth/account/summary', { as: alice.id });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ email: alice.email, emails: 2, tasks: 0 });
  });

  it('DELETE /account refuses a confirmation that does not match', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id);

    const res = await call('DELETE', '/api/v1/auth/account', {
      as: alice.id,
      body: { confirmEmail: 'not-my@address.test' },
    });

    expect(res.status).toBe(400);
    // The account and its mail are still there — a refusal must not be a
    // partial deletion.
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).not.toBeNull();
    expect(await prisma.email.count({ where: { userId: alice.id } })).toBe(1);
  });

  it('DELETE /account rejects a body with no confirmation at all', async () => {
    const { alice } = await createTwoUsers();

    const res = await call('DELETE', '/api/v1/auth/account', { as: alice.id, body: {} });

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).not.toBeNull();
  });

  it('DELETE /account deletes the caller, clears the session, and spares everyone else', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(alice.id);
    const bobEmail = await createEmail(bob.id);

    const res = await call('DELETE', '/api/v1/auth/account', {
      as: alice.id,
      body: { confirmEmail: alice.email },
    });

    expect(res.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).toBeNull();
    expect(await prisma.email.count({ where: { userId: alice.id } })).toBe(0);

    // The cookies must be cleared in the same response: the JWT stays
    // signature-valid until it expires, so without this the browser keeps
    // presenting a credential for an account that no longer exists.
    const cleared = res.headers.getSetCookie?.() ?? [];
    expect(cleared.join(';')).toMatch(/access_token=/);
    expect(cleared.join(';')).toMatch(/refresh_token=/);

    // Bob is untouched and can still use the app.
    expect(await prisma.user.findUnique({ where: { id: bob.id } })).not.toBeNull();
    expect(await prisma.email.findUnique({ where: { id: bobEmail.id } })).not.toBeNull();
  });

  it('the deleted account cannot keep using its cookie', async () => {
    const { alice } = await createTwoUsers();
    const cookie = `access_token=${signAccessToken(alice.id)}`;

    await call('DELETE', '/api/v1/auth/account', {
      as: alice.id,
      body: { confirmEmail: alice.email },
    });

    // requireAuth loads the user row, so a signature-valid token for a deleted
    // account is refused rather than trusted.
    const after = await call('GET', '/api/v1/emails/unread-count', { cookie });
    expect(after.status).toBe(401);
  });

  it.each([
    // A GET cannot carry a body, so the payload is per-case rather than shared.
    ['GET', '/api/v1/auth/account/summary', undefined],
    ['DELETE', '/api/v1/auth/account', { confirmEmail: 'x@y.test' }],
  ])('%s %s requires authentication', async (method, path, body) => {
    const res = await call(method, path, { body });
    expect(res.status).toBe(401);
  });
});

describe('/api/v1/auth', () => {
  it('GET /me answers with the caller, not with whoever was found first', async () => {
    // `getMe` reads `req.user.id`. A handler that queried `findFirst()` — the
    // shape used elsewhere in this codebase — would return Alice's profile to
    // Bob whenever Alice's row happened to sort first.
    const { alice, bob } = await createTwoUsers();

    const asAlice = await call('GET', '/api/v1/auth/me', { as: alice.id });
    expect(asAlice.status).toBe(200);
    expect(asAlice.body.data).toEqual({
      id: alice.id,
      email: alice.email,
      name: alice.name,
      avatarUrl: null,
    });

    const asBob = await call('GET', '/api/v1/auth/me', { as: bob.id });
    expect(asBob.body.data).toMatchObject({ id: bob.id, email: bob.email });
  });

  it('POST /logout clears both auth cookies', async () => {
    const { alice } = await createTwoUsers();
    const res = await call('POST', '/api/v1/auth/logout', { as: alice.id });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true });

    const setCookies = res.headers.getSetCookie().join('\n');
    // Both must be cleared. Leaving the refresh cookie behind means "log out"
    // logs nobody out — requireAuth accepts a refresh token on its own.
    expect(setCookies).toMatch(/access_token=;/);
    expect(setCookies).toMatch(/refresh_token=;/);
  });

  it('GET /google/url returns a consent URL carrying a signed state', async () => {
    const { alice } = await createTwoUsers();
    const res = await call('GET', '/api/v1/auth/google/url', { as: alice.id });

    expect(res.status).toBe(200);
    const url = (res.body.data as { url: string }).url;
    expect(url).toContain('accounts.google.com');
    // The connect flow signs the userId into the state so the callback cannot
    // be pointed at another account (the S2 fix). A bare userId in the state
    // would show up here as the raw uuid.
    const state = new URL(url).searchParams.get('state');
    expect(state).toBeTruthy();
    expect(state).not.toBe(alice.id);
  });

  it('GET /google/status reports the caller connection, never another tenant', async () => {
    // `getStatus` builds `where = userId ? { userId } : {}` and then calls
    // findFirst. If the controller ever stopped passing the userId through,
    // that empty `where` would hand the first stored Google account — email
    // address included — to whoever asked.
    const { alice, bob } = await createTwoUsers();
    await createGoogleAuth(alice.id, { email: 'alice@gmail.test' });

    const aliceStatus = await call('GET', '/api/v1/auth/google/status', { as: alice.id });
    expect(aliceStatus.status).toBe(200);
    expect(aliceStatus.body.data).toMatchObject({ connected: true, email: 'alice@gmail.test' });

    const bobStatus = await call('GET', '/api/v1/auth/google/status', { as: bob.id });
    expect(bobStatus.status).toBe(200);
    expect(bobStatus.body.data).toEqual({ connected: false });
  });

  it('GET /users lists other users and excludes the caller', async () => {
    // This feeds the share pickers. Including the caller lets someone share
    // with themselves, which `shareThread` then rejects with a 400.
    const { alice, bob } = await createTwoUsers();

    const res = await call('GET', '/api/v1/auth/users', { as: alice.id });
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([bob.id]);
  });

  it('GET and PUT /signature round-trip on the calling user only', async () => {
    const { alice, bob } = await createTwoUsers();

    const empty = await call('GET', '/api/v1/auth/signature', { as: alice.id });
    expect(empty.status).toBe(200);
    // Deliberately NOT `{ data }` — the client reads `res.data.signature`.
    // Wrapping it "for consistency" silently blanks everyone's signature.
    expect(empty.body).toEqual({ signature: null });

    const put = await call('PUT', '/api/v1/auth/signature', {
      as: alice.id,
      body: { signature: '<p>Alice</p>' },
    });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ message: 'Signature updated' });

    expect((await call('GET', '/api/v1/auth/signature', { as: alice.id })).body).toEqual({
      signature: '<p>Alice</p>',
    });
    // Alice writing her signature must not touch Bob's row.
    expect((await call('GET', '/api/v1/auth/signature', { as: bob.id })).body).toEqual({
      signature: null,
    });
  });

  it('POST /google/disconnect deletes only the caller data — REGRESSION', async () => {
    // `disconnect` scoped its GoogleAuth lookup by userId and then ran
    // `email.deleteMany({})`, `customer.deleteMany({})`, `contact.deleteMany({})`
    // and friends with *empty* where clauses. One user clicking "Disconnect
    // Google" in Settings destroyed every other tenant's synced mailbox,
    // calendar and CRM in the same transaction. Nothing recoverable, no error,
    // no audit entry.
    const { alice, bob } = await createTwoUsers();
    // Bob connects FIRST, deliberately. `disconnect` falls back to
    // `findFirst({})` when handed no userId, so whichever GoogleAuth row is
    // oldest is the one an unscoped lookup finds. With Alice's row created
    // first, dropping the userId argument still landed on Alice and the test
    // passed with the exact bug it exists to catch.
    await createGoogleAuth(bob.id, { email: 'bob@gmail.test' });
    await connectGoogleWithUndecryptableToken(alice.id, 'alice@gmail.test');

    const bobCustomer = await createCustomer(bob.id);
    const bobEmail = await createEmail(bob.id, { customerId: bobCustomer.id });
    const bobContact = await prisma.contact.create({
      data: { customerId: bobCustomer.id, firstName: 'Bob', lastName: 'Contact' },
    });
    const bobEvent = await prisma.calendarEvent.create({
      data: {
        userId: bob.id,
        googleEventId: 'bob-event-1',
        title: 'Bob standup',
        startTime: new Date(),
        endTime: new Date(Date.now() + 1_800_000),
      },
    });

    const aliceCustomer = await createCustomer(alice.id);
    const aliceEmail = await createEmail(alice.id, { customerId: aliceCustomer.id });

    const res = await call('POST', '/api/v1/auth/google/disconnect', { as: alice.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true });

    // Alice's side is gone, which is the point of the feature.
    expect(await prisma.email.findUnique({ where: { id: aliceEmail.id } })).toBeNull();
    expect(await prisma.googleAuth.findUnique({ where: { userId: alice.id } })).toBeNull();

    // Bob never touched anything.
    expect(await prisma.email.findUnique({ where: { id: bobEmail.id } })).not.toBeNull();
    expect(await prisma.customer.findUnique({ where: { id: bobCustomer.id } })).not.toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: bobContact.id } })).not.toBeNull();
    expect(await prisma.calendarEvent.findUnique({ where: { id: bobEvent.id } })).not.toBeNull();
    expect(await prisma.googleAuth.findUnique({ where: { userId: bob.id } })).not.toBeNull();
  });
});

// ── 3. /api/v1/emails — reads ────────────────────────────────────────────────

describe('/api/v1/emails reads', () => {
  it('GET / returns the caller threads with pagination meta', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 'alice-thread', subject: 'Alice mail' });
    await createEmail(bob.id, { threadId: 'bob-thread', subject: 'Bob mail' });

    const res = await call('GET', '/api/v1/emails', { as: alice.id });
    expect(res.status).toBe(200);
    // `{ data, meta }` at the top level — the list page reads `meta.total`.
    expect(res.body.meta).toMatchObject({ total: 1 });

    const threadIds = rows(res).map((t) => (t as { threadId: string }).threadId);
    expect(threadIds).toEqual(['alice-thread']);
  });

  it('GET / never surfaces another tenant thread through the search branch', async () => {
    // The search branch used to assign `where.OR` and blow away the ownership
    // filter that lived there. Driving it through the route as well as the
    // service pins that the controller forwards `search` and `req.user.id`
    // together — passing the query but the wrong id reopens the same hole.
    const { alice, bob } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 'alice-quarterly', subject: 'Quarterly review' });
    await createEmail(bob.id, { threadId: 'bob-quarterly', subject: 'Quarterly review' });
    // A share gives Alice a non-empty sharedThreadIds list, which is what
    // pushes the ownership filter into an OR in the first place.
    await createEmail(bob.id, { threadId: 'bob-shared' });
    await shareThreadWith('bob-shared', bob.id, alice.id);

    const res = await call('GET', '/api/v1/emails?search=Quarterly', { as: alice.id });
    expect(res.status).toBe(200);
    const threadIds = rows(res).map((t) => (t as { threadId: string }).threadId);
    expect(threadIds).toEqual(['alice-quarterly']);
    expect(threadIds).not.toContain('bob-quarterly');
  });

  it('GET /unread-count counts only the caller unread mail', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(alice.id, { isRead: false });
    await createEmail(bob.id, { isRead: false });
    await createEmail(bob.id, { isRead: false });

    const res = await call('GET', '/api/v1/emails/unread-count', { as: alice.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ count: 1 });
  });

  it('GET /sync-status reports this caller sync state, not anyone else\'s', async () => {
    const { alice, bob } = await createTwoUsers();
    // Stubbed per user: `false` is what a brand-new account always returns, so
    // without this the route passed with `isSyncInProgressFor` hardcoded and
    // the caller's id ignored altogether.
    vi.mocked(isSyncInProgressFor).mockImplementation((userId) => userId === alice.id);

    const busy = await call('GET', '/api/v1/emails/sync-status', { as: alice.id });
    expect(busy.status).toBe(200);
    expect(busy.body.data).toEqual({ syncing: true });

    const idle = await call('GET', '/api/v1/emails/sync-status', { as: bob.id });
    expect(idle.body.data).toEqual({ syncing: false });

    vi.mocked(isSyncInProgressFor).mockReturnValue(false);
  });

  it('GET /review-summary requires both dates and scopes totals to the caller', async () => {
    const { alice, bob } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { name: 'Acme' });
    await createEmail(alice.id, { customerId: customer.id, receivedAt: new Date('2026-03-05T10:00:00Z') });
    await createEmail(bob.id, { receivedAt: new Date('2026-03-05T10:00:00Z') });

    const missing = await call('GET', '/api/v1/emails/review-summary', { as: alice.id });
    expect(missing.status).toBe(400);
    expect(missing.body.error?.code).toBe('BAD_REQUEST');

    const res = await call(
      'GET',
      '/api/v1/emails/review-summary?dateAfter=2026-03-01T00:00:00Z&dateBefore=2026-03-31T00:00:00Z',
      { as: alice.id }
    );
    expect(res.status).toBe(200);
    // `{ data, uncategorized }` — not wrapped, the review page destructures both.
    expect(res.body.uncategorized).toMatchObject({ totalEmails: 0 });
    expect(rows(res)).toEqual([
      expect.objectContaining({ customerName: 'Acme', totalEmails: 1, totalThreads: 1 }),
    ]);
  });

  it('GET /:id refuses another tenant message and returns nothing about it', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobEmail = await createEmail(bob.id, { subject: 'Bob confidential' });

    const res = await call('GET', `/api/v1/emails/${bobEmail.id}`, { as: alice.id });
    expect(res.status).toBe(404);
    // Not just the status — the body must not carry the subject either.
    expect(res.text).not.toContain('Bob confidential');
  });

  it('GET /:id returns the caller own message', async () => {
    const { alice } = await createTwoUsers();
    const email = await createEmail(alice.id, { subject: 'Mine' });

    const res = await call('GET', `/api/v1/emails/${email.id}`, { as: alice.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: email.id, subject: 'Mine' });
  });

  it('GET /threads/:threadId refuses another tenant thread but honours a share', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(bob.id, { threadId: 'bob-private', subject: 'Private' });
    await createEmail(bob.id, { threadId: 'bob-shared', subject: 'Shared with Alice' });
    await shareThreadWith('bob-shared', bob.id, alice.id);

    const denied = await call('GET', '/api/v1/emails/threads/bob-private', { as: alice.id });
    expect(denied.status).toBe(404);
    expect(denied.text).not.toContain('Private');

    // The share path is the reason `findThread` cannot simply filter by userId,
    // so it is asserted here too — a fix that over-tightens breaks sharing.
    const allowed = await call('GET', '/api/v1/emails/threads/bob-shared', { as: alice.id });
    expect(allowed.status).toBe(200);
    expect(rows(allowed)).toHaveLength(1);
  });

  it('GET /:id/attachments/:aid keys off the right two params', async () => {
    // The handler forwards `req.params.id` and `req.params.aid` positionally
    // into `getAttachment(emailId, attachmentId, userId)`. Transposing them
    // still finds nothing for the owner (a 404 on a legitimate request), and
    // any of the three going missing turns the ownership filter into a lookup
    // by attachment id alone.
    const { alice, bob } = await createTwoUsers();
    const aliceEmail = await createEmail(alice.id);
    const aliceAttachment = await createAttachment(aliceEmail.id, 'report.pdf');
    const bobEmail = await createEmail(bob.id);
    const bobAttachment = await createAttachment(bobEmail.id, 'bob-secret.pdf');

    const own = await call('GET', `/api/v1/emails/${aliceEmail.id}/attachments/${aliceAttachment.id}`, {
      as: alice.id,
    });
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toContain('application/pdf');
    expect(own.headers.get('content-disposition')).toContain('report.pdf');

    const stolen = await call('GET', `/api/v1/emails/${bobEmail.id}/attachments/${bobAttachment.id}`, {
      as: alice.id,
    });
    expect(stolen.status).toBe(404);
    expect(gmail.attachmentsGet).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: bobAttachment.gmailAttachmentId })
    );

    // Alice's own email id paired with Bob's attachment id must also fail —
    // this is the case a missing `emailId` in the where clause would let past.
    const mixed = await call('GET', `/api/v1/emails/${aliceEmail.id}/attachments/${bobAttachment.id}`, {
      as: alice.id,
    });
    expect(mixed.status).toBe(404);
  });

  it('GET /:id/attachments/:aid cannot be used to inject a response header', async () => {
    // Gmail filenames are attacker-controlled: they arrive on inbound mail.
    // Interpolating one straight into Content-Disposition lets a sender append
    // headers of their choosing (the S3 fix).
    const { alice } = await createTwoUsers();
    const email = await createEmail(alice.id);
    const attachment = await createAttachment(email.id, 'evil"\r\nX-Injected: yes');

    const res = await call('GET', `/api/v1/emails/${email.id}/attachments/${attachment.id}`, {
      as: alice.id,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-injected')).toBeNull();
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).toContain('evil___X-Injected: yes');
  });
});

// ── 4. /api/v1/emails — per-message mutations ────────────────────────────────

describe('/api/v1/emails mutations', () => {
  /**
   * Each case carries the victim's starting state, and it is deliberately the
   * OPPOSITE of what the endpoint writes.
   *
   * Seeded uniformly at `false`, three of these tested nothing: /unread writes
   * isRead=false, /unarchive writes isArchived=false, /untrash writes
   * isTrashed=false, so a genuine cross-tenant write was a no-op and the
   * assertion below could not see it. Performing the leaked write and *still*
   * returning 404 passed.
   */
  const MUTATIONS: Array<[label: string, path: (id: string) => string, seed: Record<string, boolean>]> = [
    ['read', (id) => `/api/v1/emails/${id}/read`, { isRead: false }],
    ['unread', (id) => `/api/v1/emails/${id}/unread`, { isRead: true }],
    ['star', (id) => `/api/v1/emails/${id}/star`, { isStarred: false }],
    ['archive', (id) => `/api/v1/emails/${id}/archive`, { isArchived: false }],
    ['unarchive', (id) => `/api/v1/emails/${id}/unarchive`, { isArchived: true }],
    ['trash', (id) => `/api/v1/emails/${id}/trash`, { isTrashed: false }],
    ['untrash', (id) => `/api/v1/emails/${id}/untrash`, { isTrashed: true }],
  ];

  it.each(MUTATIONS)('PATCH /:id/%s leaves another tenant message untouched', async (_label, path, seed) => {
    // Every one of these ends in `prisma.email.update({ where: { id } })` —
    // unscoped, because the ownership check happened a few lines earlier. If
    // that check is ever weakened, the write still lands on the row.
    const { alice, bob } = await createTwoUsers();
    const bobEmail = await createEmail(bob.id, {
      isRead: false,
      isStarred: false,
      isArchived: false,
      isTrashed: false,
      ...seed,
    });

    const res = await call('PATCH', path(bobEmail.id), { as: alice.id });
    expect(res.status).toBe(404);

    const after = await prisma.email.findUniqueOrThrow({ where: { id: bobEmail.id } });
    expect(after).toMatchObject({
      isRead: false,
      isStarred: false,
      isArchived: false,
      isTrashed: false,
      ...seed,
    });
    // A leak that reached Gmail would already have leaked the message id.
    // messagesUntrash belongs here too — /untrash is the one case that does not
    // go through modify or trash, so omitting it left that route unwatched.
    expect(gmail.messagesModify).not.toHaveBeenCalled();
    expect(gmail.messagesTrash).not.toHaveBeenCalled();
    expect(gmail.messagesUntrash).not.toHaveBeenCalled();
  });

  it('PATCH /:id/read marks the caller own mail and answers { success }', async () => {
    const { alice } = await createTwoUsers();
    const email = await createEmail(alice.id, { isRead: false });

    const res = await call('PATCH', `/api/v1/emails/${email.id}/read`, { as: alice.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await prisma.email.findUniqueOrThrow({ where: { id: email.id } })).toMatchObject({
      isRead: true,
    });
  });

  it('PATCH /:id/star returns the new state under { data }', async () => {
    const { alice } = await createTwoUsers();
    const email = await createEmail(alice.id, { isStarred: false });

    const res = await call('PATCH', `/api/v1/emails/${email.id}/star`, { as: alice.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ isStarred: true });
  });

  it('POST /:id/convert-to-task refuses another tenant message and creates nothing', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobEmail = await createEmail(bob.id, { subject: 'Bob action item' });

    const res = await call('POST', `/api/v1/emails/${bobEmail.id}/convert-to-task`, {
      as: alice.id,
      body: { title: 'Stolen' },
    });
    expect(res.status).toBe(404);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.mailToTask.count()).toBe(0);
  });

  it('POST /:id/convert-to-task creates a task owned by the caller, once', async () => {
    const { alice } = await createTwoUsers();
    const email = await createEmail(alice.id, { subject: 'Follow up with Acme' });

    const created = await call('POST', `/api/v1/emails/${email.id}/convert-to-task`, {
      as: alice.id,
      body: { priority: 'HIGH' },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      title: 'Follow up with Acme',
      priority: 'HIGH',
      userId: alice.id,
    });

    // The MailToTask row carries a unique on emailId; a second conversion is a
    // 409, not a 500 from the constraint.
    const again = await call('POST', `/api/v1/emails/${email.id}/convert-to-task`, {
      as: alice.id,
      body: {},
    });
    expect(again.status).toBe(409);
  });

  it('POST /:id/reply and /forward validate the body before touching anything', async () => {
    const { alice } = await createTwoUsers();
    const email = await createEmail(alice.id);

    const reply = await call('POST', `/api/v1/emails/${email.id}/reply`, {
      as: alice.id,
      body: { htmlBody: '' },
    });
    expect(reply.status).toBe(400);
    expect(reply.body.error?.code).toBe('VALIDATION_ERROR');

    const forward = await call('POST', `/api/v1/emails/${email.id}/forward`, {
      as: alice.id,
      body: { to: [] },
    });
    expect(forward.status).toBe(400);
    expect(forward.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('POST /:id/reply refuses another tenant message', async () => {
    // `replyToEmail` checks the Google connection before it checks ownership,
    // so Alice is connected here — otherwise a 400 would mask the 404 and the
    // isolation assertion would pass for the wrong reason.
    const { alice, bob } = await createTwoUsers();
    await createGoogleAuth(alice.id, { email: 'alice@gmail.test' });
    const bobEmail = await createEmail(bob.id, { from: 'ceo@bigco.test' });

    const res = await call('POST', `/api/v1/emails/${bobEmail.id}/reply`, {
      as: alice.id,
      body: { htmlBody: '<p>hi</p>' },
    });
    expect(res.status).toBe(404);
    expect(messagesSend).not.toHaveBeenCalled();
  });

  it('POST /:id/forward refuses another tenant message', async () => {
    const { alice, bob } = await createTwoUsers();
    await createGoogleAuth(alice.id, { email: 'alice@gmail.test' });
    const bobEmail = await createEmail(bob.id);

    const res = await call('POST', `/api/v1/emails/${bobEmail.id}/forward`, {
      as: alice.id,
      body: { to: ['out@example.com'], htmlBody: '<p>fyi</p>' },
    });
    expect(res.status).toBe(404);
    expect(messagesSend).not.toHaveBeenCalled();
  });
});

// ── 5. /api/v1/emails — batch ────────────────────────────────────────────────

describe('/api/v1/emails batch', () => {
  const BATCH_PATHS = [
    '/api/v1/emails/batch/read',
    '/api/v1/emails/batch/unread',
    '/api/v1/emails/batch/archive',
    '/api/v1/emails/batch/trash',
  ];

  it('POST /batch/read rejects a missing or empty ids array', async () => {
    const { alice } = await createTwoUsers();

    const empty = await call('POST', '/api/v1/emails/batch/read', { as: alice.id, body: { ids: [] } });
    expect(empty.status).toBe(400);
    expect(empty.body.error?.code).toBe('BAD_REQUEST');
  });

  it.each(BATCH_PATHS)('%s ignores ids belonging to another tenant', async (path) => {
    // The batch handlers resolve thread ids from the supplied email ids and
    // then act on every message in those threads. The `userId` in that first
    // lookup is the only thing stopping a caller from naming somebody else's
    // ids and having the follow-up `updateMany` sweep their whole thread.
    const { alice, bob } = await createTwoUsers();
    const bobEmail = await createEmail(bob.id, {
      threadId: 'bob-batch',
      isRead: false,
      isArchived: false,
      isTrashed: false,
    });

    const res = await call('POST', path, { as: alice.id, body: { ids: [bobEmail.id] } });
    expect(res.status).toBe(200);
    // Nothing of Alice's matched, so nothing was affected.
    expect(res.body.data).toEqual({ count: 0 });

    expect(await prisma.email.findUniqueOrThrow({ where: { id: bobEmail.id } })).toMatchObject({
      isRead: false,
      isArchived: false,
      isTrashed: false,
    });
  });

  it('POST /batch/archive archives the whole thread the caller owns', async () => {
    const { alice } = await createTwoUsers();
    const first = await createEmail(alice.id, { threadId: 'alice-batch', isArchived: false });
    const second = await createEmail(alice.id, { threadId: 'alice-batch', isArchived: false });

    const res = await call('POST', '/api/v1/emails/batch/archive', {
      as: alice.id,
      body: { ids: [first.id] },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ count: 1 });

    // Selecting one message archives its siblings — that is the documented
    // batch contract, and the reason `count` is threads and not messages.
    for (const id of [first.id, second.id]) {
      expect(await prisma.email.findUniqueOrThrow({ where: { id } })).toMatchObject({ isArchived: true });
    }
  });
});

// ── 6. /api/v1/emails — sharing ──────────────────────────────────────────────

describe('/api/v1/emails thread sharing', () => {
  it('POST /threads/:threadId/share refuses a thread the caller does not own', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ email: `carol-${Date.now()}@example.com`, name: 'Carol' });
    await createEmail(bob.id, { threadId: 'bob-thread' });

    const res = await call('POST', '/api/v1/emails/threads/bob-thread/share', {
      as: alice.id,
      body: { userIds: [carol.id] },
    });
    expect(res.status).toBe(404);
    // Re-sharing someone else's thread onward is the worst case here: it makes
    // the leak permanent and attributes it to the wrong person.
    expect(await prisma.emailThreadShare.count()).toBe(0);
  });

  it('POST /threads/:threadId/share validates the recipient list', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 'alice-thread' });

    const missing = await call('POST', '/api/v1/emails/threads/alice-thread/share', {
      as: alice.id,
      body: {},
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error?.code).toBe('BAD_REQUEST');

    // Sharing with yourself is filtered out and leaves nothing to do.
    const self = await call('POST', '/api/v1/emails/threads/alice-thread/share', {
      as: alice.id,
      body: { userIds: [alice.id] },
    });
    expect(self.status).toBe(400);
  });

  it('POST /threads/:threadId/share then GET /shares round-trips', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 'alice-thread', subject: 'Deal terms' });

    const shared = await call('POST', '/api/v1/emails/threads/alice-thread/share', {
      as: alice.id,
      body: { userIds: [bob.id] },
    });
    expect(shared.status).toBe(200);
    expect(shared.body.data).toEqual({ success: true, sharedWith: 1 });

    const list = await call('GET', '/api/v1/emails/threads/alice-thread/shares', { as: alice.id });
    expect(list.status).toBe(200);
    expect(rows(list)).toEqual([
      expect.objectContaining({ sharedWith: expect.objectContaining({ id: bob.id }) }),
    ]);
  });

  it('GET /threads/:threadId/shares refuses a thread the caller does not own', async () => {
    // The recipients of a share are a social graph. A user who was *given* a
    // thread must not be able to enumerate who else has it.
    const { alice, bob } = await createTwoUsers();
    await createEmail(bob.id, { threadId: 'bob-thread' });
    await shareThreadWith('bob-thread', bob.id, alice.id);

    const res = await call('GET', '/api/v1/emails/threads/bob-thread/shares', { as: alice.id });
    expect(res.status).toBe(404);
  });

  it('DELETE /threads/:threadId/shares/:recipientId cannot revoke a share the caller did not create', async () => {
    // `unshareThread` deletes by `{ threadId, sharedByUserId: userId, ... }`
    // and returns success either way. Dropping `sharedByUserId` from that
    // where clause would let any user revoke anyone else's shares.
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ email: `carol-${Date.now()}@example.com`, name: 'Carol' });
    await createEmail(bob.id, { threadId: 'bob-thread' });
    await shareThreadWith('bob-thread', bob.id, carol.id);

    const res = await call(`DELETE`, `/api/v1/emails/threads/bob-thread/shares/${carol.id}`, {
      as: alice.id,
    });
    expect(res.status).toBe(200);
    expect(await prisma.emailThreadShare.count()).toBe(1);

    // The owner can revoke it.
    const owner = await call('DELETE', `/api/v1/emails/threads/bob-thread/shares/${carol.id}`, {
      as: bob.id,
    });
    expect(owner.status).toBe(200);
    expect(await prisma.emailThreadShare.count()).toBe(0);
  });
});

// ── 7. /api/v1/emails — scheduled sends ──────────────────────────────────────

describe('/api/v1/emails scheduled sends', () => {
  it('POST /schedule validates and stores against the caller', async () => {
    const { alice } = await createTwoUsers();

    const past = await call('POST', '/api/v1/emails/schedule', {
      as: alice.id,
      body: {
        sendAt: new Date(Date.now() - 60_000).toISOString(),
        mode: 'new',
        to: ['x@example.com'],
        htmlBody: '<p>hi</p>',
      },
    });
    expect(past.status).toBe(400);
    expect(past.body.error?.code).toBe('VALIDATION_ERROR');

    const ok = await call('POST', '/api/v1/emails/schedule', {
      as: alice.id,
      body: {
        sendAt: futureIso(),
        mode: 'new',
        to: ['x@example.com'],
        subject: 'Later',
        htmlBody: '<p>hi</p>',
      },
    });
    expect(ok.status).toBe(201);
    // The row must be stamped with the caller, not with anything from the body.
    expect(ok.body.data).toMatchObject({ userId: alice.id, status: 'pending' });
  });

  it('GET /scheduled lists only the caller pending sends', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createScheduled(alice.id, { subject: 'Mine' });
    await createScheduled(bob.id, { subject: 'Bob secret send' });

    const res = await call('GET', '/api/v1/emails/scheduled', { as: alice.id });
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([mine.id]);
    expect(res.text).not.toContain('Bob secret send');
  });

  it('PATCH /scheduled/:id refuses another tenant row and does not reschedule it', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobScheduled = await createScheduled(bob.id);

    const res = await call('PATCH', `/api/v1/emails/scheduled/${bobScheduled.id}`, {
      as: alice.id,
      body: { sendAt: futureIso() },
    });
    expect(res.status).toBe(404);

    const after = await prisma.scheduledEmail.findUniqueOrThrow({ where: { id: bobScheduled.id } });
    expect(after.sendAt.getTime()).toBe(bobScheduled.sendAt.getTime());
  });

  it('DELETE /scheduled/:id refuses another tenant row and leaves it pending', async () => {
    // Cancelling someone else's scheduled mail is a silent denial of service:
    // the sender sees "scheduled" and the message simply never goes out.
    const { alice, bob } = await createTwoUsers();
    const bobScheduled = await createScheduled(bob.id);

    const res = await call('DELETE', `/api/v1/emails/scheduled/${bobScheduled.id}`, { as: alice.id });
    expect(res.status).toBe(404);

    expect(await prisma.scheduledEmail.findUniqueOrThrow({ where: { id: bobScheduled.id } })).toMatchObject({
      status: 'pending',
    });
  });

  it('DELETE /scheduled/:id cancels the caller own pending send', async () => {
    const { alice } = await createTwoUsers();
    const scheduled = await createScheduled(alice.id);

    const res = await call('DELETE', `/api/v1/emails/scheduled/${scheduled.id}`, { as: alice.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await prisma.scheduledEmail.findUniqueOrThrow({ where: { id: scheduled.id } })).toMatchObject({
      status: 'cancelled',
    });
  });
});

// ── 8. /api/v1/emails/drafts ─────────────────────────────────────────────────

describe('/api/v1/emails/drafts', () => {
  it('GET /drafts lists only the caller drafts', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createDraft(alice.id, { subject: 'My half-written mail' });
    await createDraft(bob.id, { subject: 'Bob half-written mail' });

    const res = await call('GET', '/api/v1/emails/drafts', { as: alice.id });
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([mine.id]);
    expect(res.text).not.toContain('Bob half-written mail');
  });

  const BY_ID: Array<[method: string, suffix: string, body: unknown]> = [
    ['GET', '', undefined],
    ['PUT', '', { subject: 'hijacked', htmlBody: '<p>x</p>' }],
    ['DELETE', '', undefined],
    ['POST', '/send', { to: ['out@example.com'], htmlBody: '<p>x</p>' }],
  ];

  it.each(BY_ID)(
    '%s /drafts/:id%s refuses another tenant draft without reaching Gmail',
    async (method, suffix, body) => {
      // Drafts are unsent mail — the most private thing this app stores. A 404
      // that arrives *after* the handler has already asked Gmail for the draft
      // is not containment, so both halves are asserted.
      const { alice, bob } = await createTwoUsers();
      await createGoogleAuth(alice.id, { email: 'alice@gmail.test' });
      const bobDraft = await createDraft(bob.id, { subject: 'Bob resignation letter' });

      const res = await call(method, `/api/v1/emails/drafts/${bobDraft.id}${suffix}`, {
        as: alice.id,
        ...(body === undefined ? {} : { body }),
      });
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('Bob resignation letter');

      expect(gmail.draftsGet).not.toHaveBeenCalled();
      expect(gmail.draftsUpdate).not.toHaveBeenCalled();
      expect(gmail.draftsSend).not.toHaveBeenCalled();
      expect(gmail.draftsDelete).not.toHaveBeenCalled();

      expect(await prisma.emailDraft.findUnique({ where: { id: bobDraft.id } })).not.toBeNull();
    }
  );

  it('GET /drafts/:id opens the caller own draft through Gmail', async () => {
    const { alice } = await createTwoUsers();
    const draft = await createDraft(alice.id, { subject: 'Mine', gmailDraftId: 'gd-1' });
    gmail.draftsGet.mockResolvedValue({
      data: {
        id: 'gd-1',
        message: {
          id: 'gm-1',
          threadId: 'gt-1',
          internalDate: String(Date.UTC(2026, 0, 2)),
          payload: {
            mimeType: 'multipart/mixed',
            headers: [
              { name: 'Subject', value: 'Refreshed from Gmail' },
              { name: 'To', value: 'someone@example.com' },
            ],
            parts: [{ mimeType: 'text/html', body: { data: Buffer.from('<p>body</p>').toString('base64url') } }],
          },
        },
      },
    });

    const res = await call('GET', `/api/v1/emails/drafts/${draft.id}`, { as: alice.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: draft.id, subject: 'Refreshed from Gmail' });
    expect(gmail.draftsGet).toHaveBeenCalledWith(expect.objectContaining({ id: 'gd-1' }));
  });

  it('POST /drafts creates a draft for the caller', async () => {
    const { alice } = await createTwoUsers();
    await createGoogleAuth(alice.id, { email: 'alice@gmail.test' });

    const res = await call('POST', '/api/v1/emails/drafts', {
      as: alice.id,
      body: { to: ['x@example.com'], subject: 'Hello', htmlBody: '<p>hi</p>' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ subject: 'Hello' });

    const stored = await prisma.emailDraft.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0].userId).toBe(alice.id);
  });

  it('POST /drafts refuses when Google is not connected', async () => {
    // A draft cannot exist locally-only: Gmail is the source of truth, so
    // there is nowhere to put it. This must be a 400, not a 500 out of the
    // Gmail client.
    const { alice } = await createTwoUsers();

    const res = await call('POST', '/api/v1/emails/drafts', {
      as: alice.id,
      body: { subject: 'Hello' },
    });
    expect(res.status).toBe(400);
  });

  it('PUT /drafts/:id updates the caller own draft', async () => {
    const { alice } = await createTwoUsers();
    await createGoogleAuth(alice.id, { email: 'alice@gmail.test' });
    const draft = await createDraft(alice.id, { gmailDraftId: 'gd-put' });
    gmail.draftsUpdate.mockResolvedValue({
      data: { id: 'gd-put', message: { id: 'gm-put-2', threadId: 'gt-put' } },
    });

    const res = await call('PUT', `/api/v1/emails/drafts/${draft.id}`, {
      as: alice.id,
      body: { to: ['x@example.com'], subject: 'Edited', htmlBody: '<p>edited</p>' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ subject: 'Edited' });
    expect(gmail.draftsUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'gd-put' }));
  });

  it('DELETE /drafts/:id removes the caller own draft', async () => {
    const { alice } = await createTwoUsers();
    const draft = await createDraft(alice.id, { gmailDraftId: 'gd-del' });

    const res = await call('DELETE', `/api/v1/emails/drafts/${draft.id}`, { as: alice.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await prisma.emailDraft.findUnique({ where: { id: draft.id } })).toBeNull();
  });

  it('POST /drafts/sync reconciles the caller mirror', async () => {
    const { alice, bob } = await createTwoUsers();
    await createGoogleAuth(alice.id, { email: 'alice@gmail.test' });
    // Bob has a mirror row and is NOT syncing. syncDrafts ends with a
    // deleteMany that removes local drafts Gmail no longer lists; if that loses
    // its userId, Bob's row goes with Alice's reconciliation.
    const bobDraft = await createDraft(bob.id, { gmailDraftId: 'gd-bob' });

    gmail.draftsList.mockResolvedValue({ data: { drafts: [{ id: 'gd-remote', message: { id: 'msg-remote' } }] } });
    gmail.draftsGet.mockResolvedValue({
      data: {
        id: 'gd-remote',
        message: {
          id: 'msg-remote',
          threadId: 'gt-remote',
          payload: {
            mimeType: 'multipart/mixed',
            headers: [
              { name: 'Subject', value: 'From Gmail' },
              { name: 'To', value: 'someone@example.com' },
            ],
            parts: [{ mimeType: 'text/html', body: { data: Buffer.from('<p>hi</p>').toString('base64url') } }],
          },
        },
      },
    });

    const res = await call('POST', '/api/v1/emails/drafts/sync', { as: alice.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ synced: 1 });

    // The mirror row actually landed, for the caller...
    const mine = await prisma.emailDraft.findFirst({
      where: { userId: alice.id, gmailDraftId: 'gd-remote' },
    });
    expect(mine).not.toBeNull();
    // ...and Bob's survived.
    expect(await prisma.emailDraft.findUnique({ where: { id: bobDraft.id } })).not.toBeNull();
  });
});

// ── 9. /api/v1/emails — send and sync ────────────────────────────────────────

describe('/api/v1/emails send and sync', () => {
  it('POST /send validates the body', async () => {
    const { alice } = await createTwoUsers();

    const res = await call('POST', '/api/v1/emails/send', {
      as: alice.id,
      body: { to: ['not-an-email'], subject: 'x', htmlBody: '<p>x</p>' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    expect(messagesSend).not.toHaveBeenCalled();
  });

  it('POST /send rejects a blocked attachment type', async () => {
    // The extension blocklist is the only thing between this app and relaying
    // an executable through the user's own mailbox.
    const { alice } = await createTwoUsers();
    await createGoogleAuth(alice.id, { email: 'alice@gmail.test' });

    const res = await call('POST', '/api/v1/emails/send', {
      as: alice.id,
      body: {
        to: ['x@example.com'],
        subject: 'Invoice',
        htmlBody: '<p>see attached</p>',
        attachments: [{ filename: 'invoice.exe', content: 'AAAA', contentType: 'application/octet-stream', size: 4 }],
      },
    });
    expect(res.status).toBe(400);
    expect(messagesSend).not.toHaveBeenCalled();
  });

  it('POST /send sends as the caller connected address', async () => {
    const { alice, bob } = await createTwoUsers();
    // Bob's connection is created first on purpose: `findFirst` with no `where`
    // returns the oldest row, so an unscoped lookup here picks Bob. Creating
    // Alice's first would let that bug pass unnoticed.
    await createGoogleAuth(bob.id, { email: 'bob@gmail.test' });
    await createGoogleAuth(alice.id, { email: 'alice@gmail.test' });

    const res = await call('POST', '/api/v1/emails/send', {
      as: alice.id,
      body: { to: ['x@example.com'], subject: 'Hello', htmlBody: '<p>hi</p>' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ messageId: 'sent-msg-1' });

    // `sendEmail` picks the From header from `googleAuth.findFirst({ userId })`.
    // An unscoped findFirst there would send Alice's mail from Bob's address.
    expect(messagesSend).toHaveBeenCalledTimes(1);
    const raw = (messagesSend.mock.calls[0][0] as { requestBody: { raw: string } }).requestBody.raw;
    const mime = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(mime).toContain('alice@gmail.test');
    expect(mime).not.toContain('bob@gmail.test');
  });

  it('POST /:id/reply sends to an edited recipient, not the original sender — REGRESSION', async () => {
    // Compose renders the To field on a reply as an editable chip input, so a
    // user can remove the pre-filled address and type someone else. The server
    // used to ignore that entirely and hardcode `to = [original.from]`, so the
    // message went to the person the user had just removed — silently, with a
    // success toast. Asserting on the decoded MIME rather than the response
    // body is the point: the response looks identical either way.
    const { alice } = await createTwoUsers();
    await createGoogleAuth(alice.id, { email: 'alice@gmail.test' });
    const original = await createEmail(alice.id, { from: 'original-sender@example.com' });

    const res = await call('POST', `/api/v1/emails/${original.id}/reply`, {
      as: alice.id,
      body: { htmlBody: '<p>redirected</p>', to: ['someone-else@example.com'] },
    });
    expect(res.status).toBe(201);

    const raw = (messagesSend.mock.calls[0][0] as { requestBody: { raw: string } }).requestBody.raw;
    const mime = Buffer.from(raw, 'base64url').toString('utf-8').replace(/=\r?\n/g, '');
    const toHeader = mime.split(/\r?\n/).find((l) => l.startsWith('To:')) ?? '';
    expect(toHeader).toContain('someone-else@example.com');
    expect(toHeader).not.toContain('original-sender@example.com');
  });

  it('POST /:id/reply still defaults to the original sender when To is untouched', async () => {
    // The override must not change the ordinary case — an absent or empty `to`
    // still means "reply to whoever wrote it".
    const { alice } = await createTwoUsers();
    await createGoogleAuth(alice.id, { email: 'alice@gmail.test' });
    const original = await createEmail(alice.id, { from: 'original-sender@example.com' });

    await call('POST', `/api/v1/emails/${original.id}/reply`, {
      as: alice.id,
      body: { htmlBody: '<p>normal reply</p>' },
    });

    const raw = (messagesSend.mock.calls[0][0] as { requestBody: { raw: string } }).requestBody.raw;
    const mime = Buffer.from(raw, 'base64url').toString('utf-8').replace(/=\r?\n/g, '');
    expect(mime.split(/\r?\n/).find((l) => l.startsWith('To:')) ?? '').toContain(
      'original-sender@example.com'
    );
  });

  it('POST /:id/reply treats an empty To as untouched rather than sending nowhere', async () => {
    const { alice } = await createTwoUsers();
    await createGoogleAuth(alice.id, { email: 'alice@gmail.test' });
    const original = await createEmail(alice.id, { from: 'original-sender@example.com' });

    await call('POST', `/api/v1/emails/${original.id}/reply`, {
      as: alice.id,
      body: { htmlBody: '<p>hi</p>', to: [] },
    });

    const raw = (messagesSend.mock.calls[0][0] as { requestBody: { raw: string } }).requestBody.raw;
    const mime = Buffer.from(raw, 'base64url').toString('utf-8').replace(/=\r?\n/g, '');
    expect(mime.split(/\r?\n/).find((l) => l.startsWith('To:')) ?? '').toContain(
      'original-sender@example.com'
    );
  });

  it('POST /sync refuses when Google is not connected', async () => {
    const { alice } = await createTwoUsers();
    vi.mocked(getGmailClient).mockRejectedValue(
      Object.assign(new Error('Google not connected'), { status: 400 })
    );

    const res = await call('POST', '/api/v1/emails/sync', { as: alice.id });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toBe('Google not connected');
  });
});
