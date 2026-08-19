import { describe, it, expect } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { requireAuth } from './auth.js';
import { signAccessToken, signRefreshToken, verifyAccessToken } from '../utils/jwt.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { createUser, createTwoUsers } from '../test/factories.js';

/**
 * The authentication boundary.
 *
 * `requireAuth` is the only thing standing in front of all 135 protected
 * routes. Every ownership filter the rest of the suite tests is keyed on
 * `req.user.id`, so a defect here does not leak one user's data — it lets an
 * unauthenticated caller pick *whose* data they get. That makes it the highest
 * blast-radius function in the server, and it had no test at all.
 *
 * The middleware has three ways to say yes and one way to say no, and the
 * dangerous cases are the ones where a "no" quietly becomes a "yes":
 *
 *   - a forged token (right shape, wrong signature) — the single check that
 *     stops anyone minting `{ sub: <victim id> }` for themselves;
 *   - an expired token — the 15-minute access lifetime is the entire reason
 *     for the access/refresh split, and `ignoreExpiration` or `jwt.decode`
 *     would erase it while leaving every happy-path test green;
 *   - a token for a user row that is gone — the DB lookup is what makes a
 *     deleted account actually stop working;
 *   - a refresh token replayed as an access token.
 *
 * Most cases go through a real Express app rather than a hand-rolled req/res,
 * because half the contract lives in the plumbing: cookies have to be *parsed*
 * off the request, the reissued access token has to come back as a real
 * `Set-Cookie` header, and a rejection has to stop the request before the
 * route handler runs. A fake `res` would let a broken middleware look fine.
 * The last block calls the middleware directly, for the one assertion Express
 * cannot make visible — that `next()` is not called on the reject path.
 */

interface ProtectedBody {
  id: string | null;
  email: string | null;
}

interface UnauthorizedBody {
  error: { code: string; message: string };
}

const app = express();
app.use(cookieParser());
app.get('/protected', requireAuth, (req: Request, res: Response) => {
  // Echoes back whatever requireAuth put on the request. If the middleware
  // rejected correctly this handler never runs at all.
  res.json({ id: req.user?.id ?? null, email: req.user?.email ?? null });
});

/** `access_token=…; refresh_token=…` as supertest wants it. */
function cookies(jar: Partial<Record<'access_token' | 'refresh_token', string>>): string[] {
  return Object.entries(jar).map(([name, value]) => `${name}=${value}`);
}

function setCookieValue(headers: Record<string, unknown>, name: string): string | undefined {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : [];
  const hit = list.find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1).split(';')[0]) : undefined;
}

function setCookieNames(headers: Record<string, unknown>): string[] {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : [];
  return list.map((c) => c.split('=')[0]);
}

const expiredAccessToken = (userId: string) =>
  jwt.sign({ sub: userId, type: 'access' }, env.JWT_SECRET, { expiresIn: '-1s' });

const expiredRefreshToken = (userId: string) =>
  jwt.sign({ sub: userId, type: 'refresh' }, env.JWT_REFRESH_SECRET, { expiresIn: '-1s' });

describe('requireAuth — accepting a valid access token', () => {
  it('populates req.user and runs the route handler', async () => {
    const user = await createUser({ email: 'valid-access@example.com' });

    const res = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ access_token: signAccessToken(user.id) }));

    expect(res.status).toBe(200);
    expect(res.body as ProtectedBody).toEqual({ id: user.id, email: 'valid-access@example.com' });
  });

  it('takes the identity from the database, not from the token', async () => {
    // The token only carries `sub`. Every controller reads `req.user.email` —
    // if that were ever filled in from an attacker-supplied claim rather than
    // the User row, a token could assert any address it liked.
    const user = await createUser({ email: 'from-the-db@example.com' });
    const tokenWithExtraClaims = jwt.sign(
      { sub: user.id, type: 'access', email: 'attacker@evil.example' },
      env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const res = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ access_token: tokenWithExtraClaims }));

    expect(res.status).toBe(200);
    expect((res.body as ProtectedBody).email).toBe('from-the-db@example.com');
  });

  it('resolves each user to their own identity and never the other', async () => {
    const { alice, bob } = await createTwoUsers();

    const asAlice = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ access_token: signAccessToken(alice.id) }));
    const asBob = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ access_token: signAccessToken(bob.id) }));

    expect((asAlice.body as ProtectedBody).id).toBe(alice.id);
    expect((asAlice.body as ProtectedBody).id).not.toBe(bob.id);
    expect((asBob.body as ProtectedBody).id).toBe(bob.id);
    expect((asBob.body as ProtectedBody).id).not.toBe(alice.id);
  });

  it('does not reissue cookies when the access token is already good', async () => {
    // Only the refresh path is allowed to mint tokens. A Set-Cookie on every
    // request would mean the access token silently never expires.
    const user = await createUser();

    const res = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ access_token: signAccessToken(user.id) }));

    expect(res.status).toBe(200);
    expect(setCookieNames(res.headers as Record<string, unknown>)).toEqual([]);
  });
});

describe('requireAuth — rejecting', () => {
  it('rejects a request with no cookies at all', async () => {
    const res = await request(app).get('/protected');

    expect(res.status).toBe(401);
    expect((res.body as UnauthorizedBody).error.code).toBe('UNAUTHORIZED');
    // A 200 here would mean the route handler ran — i.e. next() was called.
    expect(res.body).not.toHaveProperty('id');
  });

  it('rejects a garbage access token', async () => {
    await createUser();

    const res = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ access_token: 'not-a-jwt-at-all' }));

    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret — FORGERY', async () => {
    // The whole point of signing. The forged token is well-formed, unexpired
    // and names a real user; only the signature is wrong. If `verify` is ever
    // downgraded to `decode` — or the secret is read from the token header —
    // anyone can mint a session for any account, and every other test in this
    // file still passes.
    const victim = await createUser({ email: 'victim@example.com' });
    const forged = jwt.sign({ sub: victim.id, type: 'access' }, 'attacker-chosen-secret', {
      expiresIn: '15m',
    });

    const res = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ access_token: forged }));

    expect(res.status).toBe(401);
    expect((res.body as ProtectedBody).id).toBeUndefined();
  });

  it('rejects a token whose payload was swapped for another user id', async () => {
    // Alice's signature over Bob's claims. Cross-tenant escalation by
    // cut-and-paste — the cheapest attack there is against a JWT.
    const { alice, bob } = await createTwoUsers();
    const [header, , signature] = signAccessToken(alice.id).split('.');
    const swapped = Buffer.from(JSON.stringify({ sub: bob.id, type: 'access' })).toString(
      'base64url'
    );

    const res = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ access_token: `${header}.${swapped}.${signature}` }));

    expect(res.status).toBe(401);
  });

  it('rejects an expired access token when there is no refresh token', async () => {
    const user = await createUser();

    const res = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ access_token: expiredAccessToken(user.id) }));

    expect(res.status).toBe(401);
    expect((res.body as UnauthorizedBody).error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an expired refresh token', async () => {
    const user = await createUser();

    const res = await request(app).get('/protected').set(
      'Cookie',
      cookies({
        access_token: expiredAccessToken(user.id),
        refresh_token: expiredRefreshToken(user.id),
      })
    );

    expect(res.status).toBe(401);
  });

  it('rejects a token for a user that no longer exists', async () => {
    // Deleting the account has to end the session. The token stays
    // cryptographically valid for its full lifetime, so the User lookup is the
    // only thing that revokes it.
    const user = await createUser();
    const token = signAccessToken(user.id);
    const refresh = signRefreshToken(user.id);
    await prisma.user.delete({ where: { id: user.id } });

    const viaAccess = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ access_token: token }));
    const viaRefresh = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ refresh_token: refresh }));

    expect(viaAccess.status).toBe(401);
    expect(viaRefresh.status).toBe(401);
  });

  it('rejects a refresh token presented as an access token — TYPE CONFUSION', async () => {
    // A refresh token is a long-lived credential the client is meant to spend
    // only on the refresh path. Presented in the access cookie with no refresh
    // cookie alongside it, it must not authenticate the request. What stops it
    // today is that the two token types are signed with different secrets;
    // unify them (a one-line environment mistake) and this is the test that
    // notices, because the middleware never checks `payload.type`.
    const user = await createUser();

    const res = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ access_token: signRefreshToken(user.id) }));

    expect(res.status).toBe(401);
  });

  it('rejects an access token presented as a refresh token', async () => {
    const user = await createUser();

    const res = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ refresh_token: signAccessToken(user.id) }));

    expect(res.status).toBe(401);
  });

  it('hands out no cookies when it rejects', async () => {
    // A rejected request must not leave a usable session behind.
    const res = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ access_token: 'garbage', refresh_token: 'garbage' }));

    expect(res.status).toBe(401);
    expect(setCookieNames(res.headers as Record<string, unknown>)).toEqual([]);
  });
});

describe('requireAuth — refresh-token fallback', () => {
  it('re-issues an access token cookie and lets the request through', async () => {
    // The 15-minute access token expires constantly during normal use; this
    // path is what keeps a logged-in user logged in. If it breaks, the app
    // logs everyone out every quarter of an hour.
    const user = await createUser({ email: 'refreshed@example.com' });

    const res = await request(app).get('/protected').set(
      'Cookie',
      cookies({
        access_token: expiredAccessToken(user.id),
        refresh_token: signRefreshToken(user.id),
      })
    );

    expect(res.status).toBe(200);
    expect(res.body as ProtectedBody).toEqual({ id: user.id, email: 'refreshed@example.com' });

    const reissued = setCookieValue(res.headers as Record<string, unknown>, 'access_token');
    expect(reissued).toBeTruthy();
    // The replacement has to be a genuine, currently-valid access token for the
    // same user — echoing back the expired one would loop the client forever.
    const payload = verifyAccessToken(reissued as string);
    expect(payload.sub).toBe(user.id);
    expect(payload.type).toBe('access');
  });

  it('re-issues the refresh cookie too, so the session keeps rolling', async () => {
    const user = await createUser();
    const refresh = signRefreshToken(user.id);

    const res = await request(app).get('/protected').set(
      'Cookie',
      cookies({ access_token: expiredAccessToken(user.id), refresh_token: refresh })
    );

    expect(setCookieNames(res.headers as Record<string, unknown>).sort()).toEqual([
      'access_token',
      'refresh_token',
    ]);
    expect(setCookieValue(res.headers as Record<string, unknown>, 'refresh_token')).toBe(refresh);
  });

  it('marks the re-issued cookies httpOnly', async () => {
    // These cookies carry the session. Readable from JavaScript, any XSS in the
    // app becomes full account takeover.
    const user = await createUser();

    const res = await request(app).get('/protected').set(
      'Cookie',
      cookies({
        access_token: expiredAccessToken(user.id),
        refresh_token: signRefreshToken(user.id),
      })
    );

    const raw = res.headers['set-cookie'] as unknown;
    const list = Array.isArray(raw) ? (raw as string[]) : [];
    expect(list).toHaveLength(2);
    for (const cookie of list) {
      expect(cookie).toMatch(/HttpOnly/i);
    }
  });

  it('works with no access token at all, not only an expired one', async () => {
    // The access cookie has a shorter max-age than the refresh cookie, so the
    // browser drops it first and the next request arrives carrying refresh
    // only. That is the common case, not an edge case.
    const user = await createUser();

    const res = await request(app)
      .get('/protected')
      .set('Cookie', cookies({ refresh_token: signRefreshToken(user.id) }));

    expect(res.status).toBe(200);
    expect((res.body as ProtectedBody).id).toBe(user.id);
  });

  it('resolves the refresh token to its own user and not another', async () => {
    const { alice, bob } = await createTwoUsers();

    const res = await request(app).get('/protected').set(
      'Cookie',
      cookies({
        access_token: expiredAccessToken(bob.id),
        refresh_token: signRefreshToken(alice.id),
      })
    );

    expect(res.status).toBe(200);
    expect((res.body as ProtectedBody).id).toBe(alice.id);
    expect((res.body as ProtectedBody).id).not.toBe(bob.id);
  });

  it('rejects a forged refresh token', async () => {
    const victim = await createUser();
    const forged = jwt.sign({ sub: victim.id, type: 'refresh' }, 'attacker-chosen-secret', {
      expiresIn: '7d',
    });

    const res = await request(app).get('/protected').set(
      'Cookie',
      cookies({ access_token: expiredAccessToken(victim.id), refresh_token: forged })
    );

    expect(res.status).toBe(401);
  });
});

/**
 * Called directly, because Express hides the failure mode this checks.
 *
 * If `requireAuth` both sent a 401 and called `next()`, the route handler would
 * run anyway — writing to an already-sent response, mutating data on behalf of
 * an unauthenticated caller — while the client still saw a tidy 401. Through
 * supertest that is invisible; only the middleware's own `next` shows it.
 */
interface Captured {
  statusCode: number | null;
  body: unknown;
}

function makeRes() {
  const captured: Captured = { statusCode: null, body: undefined };
  const fake = {
    status(code: number) {
      captured.statusCode = code;
      return fake;
    },
    json(payload: unknown) {
      captured.body = payload;
      return fake;
    },
    cookie() {
      return fake;
    },
  };
  return { res: fake as unknown as Response, captured };
}

function makeReq(jar: Record<string, string>) {
  return { cookies: jar } as unknown as Request;
}

/**
 * A recording `next`. Hand-rolled rather than `vi.fn()` because Express's
 * NextFunction is an overloaded call signature that a Mock does not satisfy
 * without an unsafe cast.
 */
function makeNext() {
  const calls: unknown[] = [];
  const next: NextFunction = (err?: unknown) => {
    calls.push(err);
  };
  return { next, calls };
}

describe('requireAuth — control flow', () => {
  it('does not call next() when it rejects', async () => {
    const { res, captured } = makeRes();
    const { next, calls } = makeNext();

    await requireAuth(makeReq({ access_token: 'garbage' }), res, next);

    expect(captured.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('calls next() exactly once, with no error, when it accepts', async () => {
    const user = await createUser();
    const { res, captured } = makeRes();
    const { next, calls } = makeNext();

    await requireAuth(makeReq({ access_token: signAccessToken(user.id) }), res, next);

    // Passing an error argument would route an authenticated request into the
    // error handler instead of the controller.
    expect(calls).toEqual([undefined]);
    expect(captured.statusCode).toBeNull();
  });

  it('survives a request with no cookie parser mounted', async () => {
    // `req.cookies` is undefined if cookieParser has not run. It should be a
    // 401, not a TypeError escaping into the error handler as a 500.
    const { res, captured } = makeRes();
    const { next, calls } = makeNext();
    const req = {} as unknown as Request;

    await expect(requireAuth(req, res, next)).resolves.toBeUndefined();

    expect(captured.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
