import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, vi } from 'vitest';
import { app } from '../app.js';
import { isCalendarSyncInProgress, runCalendarManualSync } from '../jobs/calendarSyncScheduler.js';
import { prisma } from '../lib/prisma.js';
import { signAccessToken } from '../utils/jwt.js';
import {
  createTwoUsers,
  createTask,
  createEmail,
  createCustomer,
  createDealPartner,
} from '../test/factories.js';

// Only the status probe is stubbed; the scheduler's own behaviour is covered in
// jobs/schedulers.test.ts. Real sync state is unreachable from a route test,
// and without a stub `syncing: false` is the only value the route can return.
vi.mock('../jobs/calendarSyncScheduler.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs/calendarSyncScheduler.js')>()),
  isCalendarSyncInProgress: vi.fn(() => false),
}));

/**
 * Route-level smoke coverage for calendar, settings and the small
 * "everything else" routers.
 *
 * The service tests exercise the query builders. This file exercises the
 * *wiring* — the layer nothing else looks at:
 *
 *  - **Every protected router is actually behind `requireAuth`.** A router is
 *    mounted in `app.ts` by hand, and forgetting the middleware on one line
 *    publishes an entire feature's data to the internet. Nothing else in the
 *    suite would notice: the controllers all read `req.user!.id`, so an
 *    unauthenticated hit crashes with a 500 at worst and returns whatever the
 *    stray id resolved to at best. The `it.each` table below is the whole
 *    surface, and a new router added without the guard fails here.
 *  - **`/api/health` stays public.** It is Railway's healthcheck. Putting it
 *    behind auth does not fail any test that mocks its way past the middleware
 *    — it fails the deploy, by rolling every release back.
 *  - **A request carrying user A's cookie can never read or write user B's
 *    rows.** Asserted end-to-end through the real router/controller/service
 *    stack against a real database, because the bug class this repo keeps
 *    hitting is a where-clause that silently stops constraining by userId, and
 *    an ownership check that lives in the service is only load-bearing if the
 *    controller actually passes `req.user!.id` into it.
 *
 * Where a cross-tenant write is expected to be refused, the test asserts the
 * victim's row is unchanged in the database as well as the status code. The
 * status alone is not proof: several of these paths answer `{ success: true }`
 * on an `updateMany` that matched nothing, which is the correct behaviour and
 * indistinguishable from a leak if you only look at the response.
 */

/** A cookie header carrying a valid access token, as `requireAuth` reads it. */
function cookieFor(userId: string): string {
  return `access_token=${signAccessToken(userId)}`;
}

// ── Local fixtures ───────────────────────────────────────────────────────────
// Defined here rather than in test/factories.ts, which is shared.

let seq = 0;
const uniq = () => `${Date.now().toString(36)}-${++seq}`;

function createEvent(
  userId: string,
  overrides: Partial<{ title: string; startTime: Date; endTime: Date; googleEventId: string }> = {}
) {
  const start = overrides.startTime ?? new Date('2026-09-01T09:00:00.000Z');
  return prisma.calendarEvent.create({
    data: {
      userId,
      title: overrides.title ?? `Event ${uniq()}`,
      startTime: start,
      endTime: overrides.endTime ?? new Date(start.getTime() + 3_600_000),
      ...(overrides.googleEventId ? { googleEventId: overrides.googleEventId } : {}),
    },
  });
}

function createLabel(userId: string, name = `Label ${uniq()}`, color = '#4589ff') {
  return prisma.label.create({ data: { userId, name, color } });
}

function createTaskStatus(userId: string, name = `STATUS_${uniq()}`, position = 0) {
  return prisma.taskStatus.create({
    data: { userId, name, label: name, color: '#4589ff', position },
  });
}

function createCompanyCategory(userId: string, name = `CATEGORY_${uniq()}`, position = 0) {
  return prisma.companyCategory.create({
    data: { userId, name, label: name, color: '#4589ff', position },
  });
}

function createNotification(
  userId: string,
  overrides: Partial<{ title: string; isRead: boolean; isDismissed: boolean }> = {}
) {
  return prisma.notification.create({
    data: {
      userId,
      type: 'TEST',
      title: overrides.title ?? `Notification ${uniq()}`,
      ...(overrides.isRead !== undefined ? { isRead: overrides.isRead } : {}),
      ...(overrides.isDismissed !== undefined ? { isDismissed: overrides.isDismissed } : {}),
    },
  });
}

function createAuditLog(
  userId: string,
  overrides: Partial<{ action: string; entityType: string; entityId: string; subject: string }> = {}
) {
  return prisma.auditLog.create({
    data: {
      userId,
      action: overrides.action ?? 'EMAIL_SENT',
      entityType: overrides.entityType ?? 'email',
      entityId: overrides.entityId ?? `entity-${uniq()}`,
      details: { subject: overrides.subject ?? `Subject ${uniq()}` },
    },
  });
}

function createTemplate(
  userId: string,
  overrides: Partial<{ name: string; kind: string; subject: string; body: string }> = {}
) {
  return prisma.emailTemplate.create({
    data: {
      userId,
      name: overrides.name ?? `Template ${uniq()}`,
      kind: overrides.kind ?? 'template',
      subject: overrides.subject ?? `Subject ${uniq()}`,
      body: overrides.body ?? 'Hello there',
    },
  });
}

function createReminder(
  userId: string,
  threadId: string,
  overrides: Partial<{ kind: string; remindAt: Date; state: string }> = {}
) {
  return prisma.emailReminder.create({
    data: {
      userId,
      threadId,
      kind: overrides.kind ?? 'snooze',
      remindAt: overrides.remindAt ?? new Date(Date.now() + 86_400_000),
      armedAt: new Date(),
      ...(overrides.state ? { state: overrides.state } : {}),
    },
  });
}

// ── The auth gate ────────────────────────────────────────────────────────────

/**
 * Every route in this file's area, as `app.ts` mounts them.
 *
 * The ids are deliberately nonsense: the point is that the request never gets
 * far enough for the id to matter. A route that answers anything other than 401
 * here has lost its `requireAuth`.
 */
const PROTECTED_ROUTES: Array<[method: 'get' | 'post' | 'patch' | 'delete', path: string]> = [
  ['get', '/api/v1/calendar'],
  ['get', '/api/v1/calendar/sync-status'],
  ['post', '/api/v1/calendar/sync'],
  ['get', '/api/v1/calendar/some-id'],
  ['post', '/api/v1/calendar'],
  ['patch', '/api/v1/calendar/some-id'],
  ['delete', '/api/v1/calendar/some-id'],
  ['post', '/api/v1/calendar/some-id/respond'],

  ['get', '/api/v1/labels'],
  ['post', '/api/v1/labels'],
  ['patch', '/api/v1/labels/some-id'],
  ['delete', '/api/v1/labels/some-id'],

  ['get', '/api/v1/task-statuses'],
  ['post', '/api/v1/task-statuses'],
  ['patch', '/api/v1/task-statuses/reorder'],
  ['patch', '/api/v1/task-statuses/some-id'],
  ['delete', '/api/v1/task-statuses/some-id'],

  ['get', '/api/v1/company-categories'],
  ['post', '/api/v1/company-categories'],
  ['patch', '/api/v1/company-categories/reorder'],
  ['patch', '/api/v1/company-categories/some-id'],
  ['delete', '/api/v1/company-categories/some-id'],

  ['get', '/api/v1/deal-partners'],
  ['post', '/api/v1/deal-partners'],
  ['patch', '/api/v1/deal-partners/some-id'],
  ['delete', '/api/v1/deal-partners/some-id'],

  ['get', '/api/v1/dashboard/stats'],
  ['get', '/api/v1/dashboard/nav-counts'],

  ['get', '/api/v1/search'],

  ['get', '/api/v1/notifications'],
  ['get', '/api/v1/notifications/count'],
  ['patch', '/api/v1/notifications/some-id/read'],
  ['post', '/api/v1/notifications/read-all'],
  ['delete', '/api/v1/notifications/some-id'],
  ['post', '/api/v1/notifications/dismiss-all'],

  ['get', '/api/v1/audit-logs'],
  ['get', '/api/v1/audit-logs/some-id'],

  ['get', '/api/v1/onboarding/status'],
  ['post', '/api/v1/onboarding/task-statuses'],
  ['post', '/api/v1/onboarding/complete'],
  ['post', '/api/v1/onboarding/reset'],

  ['get', '/api/v1/templates'],
  ['get', '/api/v1/templates/variables'],
  ['post', '/api/v1/templates'],
  ['patch', '/api/v1/templates/some-id'],
  ['delete', '/api/v1/templates/some-id'],
  ['post', '/api/v1/templates/some-id/render'],

  ['get', '/api/v1/snooze'],
  ['post', '/api/v1/snooze'],
  ['delete', '/api/v1/snooze/some-id'],
];

describe('route auth gate', () => {
  // If any of these stops being 401, a router lost `requireAuth` in app.ts and
  // that feature's data is readable without a session.
  it.each(PROTECTED_ROUTES)('%s %s requires authentication', async (method, path) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  // Not an oversight — Railway's healthcheck hits this unauthenticated, and a
  // 401 here rolls back every deploy.
  it('leaves /api/health public', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('rejects a malformed token', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .get('/api/v1/labels')
      .set('Cookie', `access_token=${alice.id}.not-a-jwt`);
    expect(res.status).toBe(401);
  });

  /**
   * The forged token is structurally perfect and carries a real user id — only
   * the signature is wrong. That distinction is the whole test: swapping
   * `jwt.verify` for `jwt.decode` in utils/jwt.ts reads like a simplification
   * and turns the app into "send whichever user id you like", yet every
   * malformed-token test still passes, because `decode` rejects garbage too.
   * Nothing but a validly-shaped token signed with the wrong key tells the two
   * implementations apart.
   */
  it('rejects a well-formed token signed with the wrong secret', async () => {
    const { alice } = await createTwoUsers();
    const forged = jwt.sign({ sub: alice.id, type: 'access' }, 'not-the-real-secret', {
      expiresIn: '15m',
    });

    const res = await request(app).get('/api/v1/labels').set('Cookie', `access_token=${forged}`);

    expect(res.status).toBe(401);
  });

  // A token is only as good as the account behind it. Deleting a user has to
  // revoke their sessions, and nothing else re-checks that.
  it('rejects a well-formed token for a user that no longer exists', async () => {
    const { alice } = await createTwoUsers();
    const cookie = cookieFor(alice.id);
    await prisma.user.delete({ where: { id: alice.id } });

    const res = await request(app).get('/api/v1/labels').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });
});

// ── Calendar ─────────────────────────────────────────────────────────────────

describe('GET /api/v1/calendar', () => {
  it('returns only the caller\'s events', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createEvent(alice.id, { title: 'Mine' });
    await createEvent(bob.id, { title: 'Theirs' });

    const res = await request(app).get('/api/v1/calendar').set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(mine.id);
  });

  it('applies the start/end window without dropping the ownership filter', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEvent(alice.id, {
      title: 'In window',
      startTime: new Date('2026-09-10T09:00:00.000Z'),
      endTime: new Date('2026-09-10T10:00:00.000Z'),
    });
    await createEvent(alice.id, {
      title: 'Out of window',
      startTime: new Date('2026-11-10T09:00:00.000Z'),
      endTime: new Date('2026-11-10T10:00:00.000Z'),
    });
    await createEvent(bob.id, {
      title: 'Bob in window',
      startTime: new Date('2026-09-11T09:00:00.000Z'),
      endTime: new Date('2026-09-11T10:00:00.000Z'),
    });

    const res = await request(app)
      .get('/api/v1/calendar?start=2026-09-01T00:00:00.000Z&end=2026-09-30T00:00:00.000Z')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data.map((e: { title: string }) => e.title)).toEqual(['In window']);
  });
});

describe('calendar single-event routes', () => {
  it('creates an event owned by the caller', async () => {
    const { alice } = await createTwoUsers();

    const res = await request(app)
      .post('/api/v1/calendar')
      .set('Cookie', cookieFor(alice.id))
      .send({
        title: 'Kickoff',
        startTime: '2026-09-01T09:00:00.000Z',
        endTime: '2026-09-01T10:00:00.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Kickoff');
    const stored = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(stored.userId).toBe(alice.id);
  });

  it('rejects a create with no title', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .post('/api/v1/calendar')
      .set('Cookie', cookieFor(alice.id))
      .send({ startTime: '2026-09-01T09:00:00.000Z', endTime: '2026-09-01T10:00:00.000Z' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404s on another user\'s event rather than returning it', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createEvent(bob.id, { title: 'Board meeting' });

    const res = await request(app)
      .get(`/api/v1/calendar/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Board meeting');
  });

  // The response code matters less than the row: a PATCH that reached Bob's
  // event would rewrite a calendar entry in someone else's account.
  it('cannot patch another user\'s event', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createEvent(bob.id, { title: 'Board meeting' });

    const res = await request(app)
      .patch(`/api/v1/calendar/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id))
      .send({ title: 'Hijacked' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    const after = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.title).toBe('Board meeting');
  });

  it('cannot delete another user\'s event', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createEvent(bob.id);

    const res = await request(app)
      .delete(`/api/v1/calendar/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(404);
    expect(await prisma.calendarEvent.count({ where: { id: theirs.id } })).toBe(1);
  });

  it('deletes the caller\'s own event', async () => {
    const { alice } = await createTwoUsers();
    const mine = await createEvent(alice.id);

    const res = await request(app)
      .delete(`/api/v1/calendar/${mine.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(204);
    expect(await prisma.calendarEvent.count({ where: { id: mine.id } })).toBe(0);
  });

  it('refuses to respond to another user\'s event', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createEvent(bob.id, { googleEventId: 'g-1' });

    const res = await request(app)
      .post(`/api/v1/calendar/${theirs.id}/respond`)
      .set('Cookie', cookieFor(alice.id))
      .send({ response: 'accepted' });

    expect(res.status).toBe(404);
  });

  it('validates the respond payload', async () => {
    const { alice } = await createTwoUsers();
    // Needs a googleEventId: without one the service raises its own 400
    // ("Cannot respond to non-Google events") before the body is ever looked
    // at, and a bare `status === 400` cannot tell the two 400s apart — removing
    // `validate(respondEventSchema)` from the route left this passing.
    const mine = await createEvent(alice.id, { googleEventId: 'g-1' });

    const res = await request(app)
      .post(`/api/v1/calendar/${mine.id}/respond`)
      .set('Cookie', cookieFor(alice.id))
      .send({ response: 'maybe' });

    expect(res.status).toBe(400);
    // The code is what separates "the validator rejected this" from "the
    // service refused a non-Google event".
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('calendar sync routes', () => {
  it('reports per-user sync status', async () => {
    const { alice, bob } = await createTwoUsers();
    // One account mid-sync, one not. Without this the assertion was `false` for
    // a fresh user — the value a collapsed global flag, or a function ignoring
    // its argument entirely, returns just as happily.
    vi.mocked(isCalendarSyncInProgress).mockImplementation((userId) => userId === alice.id);

    const busy = await request(app)
      .get('/api/v1/calendar/sync-status')
      .set('Cookie', cookieFor(alice.id));
    expect(busy.body).toEqual({ data: { syncing: true } });

    const idle = await request(app)
      .get('/api/v1/calendar/sync-status')
      .set('Cookie', cookieFor(bob.id));
    expect(idle.body).toEqual({ data: { syncing: false } });

    vi.mocked(isCalendarSyncInProgress).mockReturnValue(false);
    const res = await request(app)
      .get('/api/v1/calendar/sync-status')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { syncing: false } });
  });

  // No Google connection means no calendar client. The 400 is what the client
  // needs to prompt a reconnect — a 500 here would surface as "something went
  // wrong" with no route out of it.
  /**
   * "Sync now" has to lose to a sync that is already running.
   *
   * The route called `syncFromGoogle` directly, outside the per-account guard,
   * so it could start a second sync for an account already syncing. That is
   * not merely duplicated work: the sync token is null for the whole duration
   * of a full sync, so the second one also takes the full branch, and each
   * then runs a reconciliation that deletes local rows missing from its own
   * listing — one deletes what the other just wrote, and an incremental sync
   * cannot bring them back.
   *
   * `runCalendarManualSync` here is the real function the route uses, so
   * holding the account through it reproduces exactly what a scheduled tick
   * creates.
   */
  it('answers 409 while that account is already syncing', async () => {
    const { alice, bob } = await createTwoUsers();

    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const held = runCalendarManualSync(alice.id, () => blocked);
    // Let runExclusive register the account before the request goes out.
    await new Promise((r) => setTimeout(r, 10));

    const res = await request(app)
      .post('/api/v1/calendar/sync')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('SYNC_IN_PROGRESS');

    // Per account, not a global flag: Bob is unaffected and reaches the real
    // handler, which refuses him for the unrelated reason that he has no
    // Google connection. Without this the test would pass against a global lock.
    const other = await request(app)
      .post('/api/v1/calendar/sync')
      .set('Cookie', cookieFor(bob.id));
    expect(other.status).toBe(400);

    release();
    await held;
  });

  it('answers 400, not 500, when Google is not connected', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .post('/api/v1/calendar/sync')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(400);
  });
});

// ── Labels ───────────────────────────────────────────────────────────────────

describe('/api/v1/labels', () => {
  it('lists only the caller\'s labels, with task counts', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createLabel(alice.id, 'Mine');
    await createLabel(bob.id, 'Theirs');

    const res = await request(app).get('/api/v1/labels').set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(mine.id);
    expect(res.body.data[0]._count.tasks).toBe(0);
  });

  it('creates a label owned by the caller', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .post('/api/v1/labels')
      .set('Cookie', cookieFor(alice.id))
      .send({ name: 'Urgent', color: '#da1e28' });

    expect(res.status).toBe(201);
    const stored = await prisma.label.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(stored.userId).toBe(alice.id);
  });

  /**
   * The label unique is `(user_id, name)`. A global unique on `name` — the
   * shape this schema shipped with before user-scoping — makes the second
   * user's create a 409 and blocks multi-tenancy outright.
   */
  it('lets two users hold the same label name', async () => {
    const { alice, bob } = await createTwoUsers();

    const first = await request(app)
      .post('/api/v1/labels')
      .set('Cookie', cookieFor(alice.id))
      .send({ name: 'Urgent', color: '#da1e28' });
    const second = await request(app)
      .post('/api/v1/labels')
      .set('Cookie', cookieFor(bob.id))
      .send({ name: 'Urgent', color: '#da1e28' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it('409s on a duplicate name for the same user', async () => {
    const { alice } = await createTwoUsers();
    await createLabel(alice.id, 'Urgent');

    const res = await request(app)
      .post('/api/v1/labels')
      .set('Cookie', cookieFor(alice.id))
      .send({ name: 'Urgent', color: '#da1e28' });

    expect(res.status).toBe(409);
  });

  it('rejects a non-hex colour', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .post('/api/v1/labels')
      .set('Cookie', cookieFor(alice.id))
      .send({ name: 'Urgent', color: 'red' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('cannot rename another user\'s label', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createLabel(bob.id, 'Theirs');

    const res = await request(app)
      .patch(`/api/v1/labels/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id))
      .send({ name: 'Hijacked' });

    expect(res.status).toBe(404);
    const after = await prisma.label.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.name).toBe('Theirs');
  });

  it('cannot delete another user\'s label', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createLabel(bob.id, 'Theirs');

    const res = await request(app)
      .delete(`/api/v1/labels/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(404);
    expect(await prisma.label.count({ where: { id: theirs.id } })).toBe(1);
  });
});

// ── Task statuses ────────────────────────────────────────────────────────────

describe('/api/v1/task-statuses', () => {
  it('lists only the caller\'s statuses, in board order', async () => {
    const { alice, bob } = await createTwoUsers();
    await createTaskStatus(alice.id, 'DONE', 2);
    await createTaskStatus(alice.id, 'TODO', 0);
    await createTaskStatus(bob.id, 'BOB_ONLY', 0);

    const res = await request(app).get('/api/v1/task-statuses').set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { name: string }) => s.name)).toEqual(['TODO', 'DONE']);
  });

  it('derives the status name from the label', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .post('/api/v1/task-statuses')
      .set('Cookie', cookieFor(alice.id))
      .send({ label: 'In review' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('IN_REVIEW');
    expect(res.body.data.label).toBe('In review');
  });

  it('rejects a create with an empty label', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .post('/api/v1/task-statuses')
      .set('Cookie', cookieFor(alice.id))
      .send({ label: '' });

    expect(res.status).toBe(400);
  });

  it('cannot rename another user\'s status', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createTaskStatus(bob.id, 'THEIRS');

    const res = await request(app)
      .patch(`/api/v1/task-statuses/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id))
      .send({ label: 'Hijacked' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    const after = await prisma.taskStatus.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.label).toBe('THEIRS');
  });

  /**
   * Reorder takes a list of ids straight from the client. Without the userId
   * filter on each update, dragging a column would let one account renumber
   * another account's Kanban board — and the ids are guessable from any shared
   * entity's payload.
   */
  it('cannot reorder another user\'s statuses', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createTaskStatus(alice.id, 'MINE', 0);
    const theirs = await createTaskStatus(bob.id, 'THEIRS', 0);

    const res = await request(app)
      .patch('/api/v1/task-statuses/reorder')
      .set('Cookie', cookieFor(alice.id))
      .send({
        items: [
          { id: mine.id, position: 1 },
          { id: theirs.id, position: 5 },
        ],
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await prisma.taskStatus.findUniqueOrThrow({ where: { id: theirs.id } })).position).toBe(0);
    // The whole batch is one transaction, so the caller's own move rolls back too.
    expect((await prisma.taskStatus.findUniqueOrThrow({ where: { id: mine.id } })).position).toBe(0);
  });

  it('reorders the caller\'s own statuses', async () => {
    const { alice } = await createTwoUsers();
    const first = await createTaskStatus(alice.id, 'FIRST', 0);
    const second = await createTaskStatus(alice.id, 'SECOND', 1);

    const res = await request(app)
      .patch('/api/v1/task-statuses/reorder')
      .set('Cookie', cookieFor(alice.id))
      .send({
        items: [
          { id: first.id, position: 1 },
          { id: second.id, position: 0 },
        ],
      });

    expect(res.status).toBe(200);
    expect((await prisma.taskStatus.findUniqueOrThrow({ where: { id: first.id } })).position).toBe(1);
  });

  it('cannot delete another user\'s status', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createTaskStatus(bob.id, 'THEIRS');

    const res = await request(app)
      .delete(`/api/v1/task-statuses/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(404);
    expect(await prisma.taskStatus.count({ where: { id: theirs.id } })).toBe(1);
  });

  // Deleting a column that tasks still sit in would strand them in a status the
  // board cannot render.
  it('409s on deleting a status that tasks still use', async () => {
    const { alice } = await createTwoUsers();
    const status = await createTaskStatus(alice.id, 'IN_USE');
    await createTask(alice.id, { status: 'IN_USE' });

    const res = await request(app)
      .delete(`/api/v1/task-statuses/${status.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(409);
  });

  // ...but only tasks belonging to the caller. Counting every user's tasks
  // would make a status undeletable because a stranger picked the same name.
  it('ignores another user\'s tasks when checking whether a status is in use', async () => {
    const { alice, bob } = await createTwoUsers();
    const status = await createTaskStatus(alice.id, 'SHARED_NAME');
    await createTask(bob.id, { status: 'SHARED_NAME' });

    const res = await request(app)
      .delete(`/api/v1/task-statuses/${status.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
  });
});

// ── Company categories ───────────────────────────────────────────────────────

describe('/api/v1/company-categories', () => {
  it('lists only the caller\'s categories', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createCompanyCategory(alice.id, 'MINE');
    await createCompanyCategory(bob.id, 'THEIRS');

    const res = await request(app)
      .get('/api/v1/company-categories')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(mine.id);
  });

  it('creates a category owned by the caller', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .post('/api/v1/company-categories')
      .set('Cookie', cookieFor(alice.id))
      .send({ label: 'Key account', color: '#24a148' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('KEY_ACCOUNT');
    const stored = await prisma.companyCategory.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(stored.userId).toBe(alice.id);
  });

  it('cannot delete another user\'s category', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createCompanyCategory(bob.id, 'THEIRS');

    const res = await request(app)
      .delete(`/api/v1/company-categories/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(404);
    expect(await prisma.companyCategory.count({ where: { id: theirs.id } })).toBe(1);
  });

  it('409s on deleting a category companies still use', async () => {
    const { alice } = await createTwoUsers();
    const category = await createCompanyCategory(alice.id, 'IN_USE');
    const customer = await createCustomer(alice.id);
    await prisma.customer.update({ where: { id: customer.id }, data: { categoryId: category.id } });

    const res = await request(app)
      .delete(`/api/v1/company-categories/${category.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(409);
  });

  it('cannot reorder another user\'s categories', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createCompanyCategory(bob.id, 'THEIRS', 0);

    const res = await request(app)
      .patch('/api/v1/company-categories/reorder')
      .set('Cookie', cookieFor(alice.id))
      .send({ items: [{ id: theirs.id, position: 9 }] });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(
      (await prisma.companyCategory.findUniqueOrThrow({ where: { id: theirs.id } })).position
    ).toBe(0);
  });
});

// ── Deal partners ────────────────────────────────────────────────────────────

describe('/api/v1/deal-partners', () => {
  it('lists only the caller\'s partners', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createDealPartner(alice.id, 'Mine');
    await createDealPartner(bob.id, 'Theirs');

    const res = await request(app).get('/api/v1/deal-partners').set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(mine.id);
  });

  it('creates a partner owned by the caller', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .post('/api/v1/deal-partners')
      .set('Cookie', cookieFor(alice.id))
      .send({ name: 'Acme' });

    expect(res.status).toBe(201);
    const stored = await prisma.dealPartner.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(stored.userId).toBe(alice.id);
  });

  it('lets two users hold the same partner name', async () => {
    const { alice, bob } = await createTwoUsers();

    const first = await request(app)
      .post('/api/v1/deal-partners')
      .set('Cookie', cookieFor(alice.id))
      .send({ name: 'Acme' });
    const second = await request(app)
      .post('/api/v1/deal-partners')
      .set('Cookie', cookieFor(bob.id))
      .send({ name: 'Acme' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it('409s on a duplicate partner name for the same user', async () => {
    const { alice } = await createTwoUsers();
    await createDealPartner(alice.id, 'Acme');

    const res = await request(app)
      .post('/api/v1/deal-partners')
      .set('Cookie', cookieFor(alice.id))
      .send({ name: 'Acme' });

    expect(res.status).toBe(409);
  });

  it('cannot rename another user\'s partner', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createDealPartner(bob.id, 'Theirs');

    const res = await request(app)
      .patch(`/api/v1/deal-partners/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id))
      .send({ name: 'Hijacked' });

    expect(res.status).toBe(404);
    const after = await prisma.dealPartner.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.name).toBe('Theirs');
  });

  it('cannot delete another user\'s partner', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createDealPartner(bob.id, 'Theirs');

    const res = await request(app)
      .delete(`/api/v1/deal-partners/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(404);
    expect(await prisma.dealPartner.count({ where: { id: theirs.id } })).toBe(1);
  });
});

// ── Dashboard ────────────────────────────────────────────────────────────────

describe('/api/v1/dashboard', () => {
  it('returns the stats sections the dashboard renders', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(
      ['calendar', 'charts', 'customers', 'emails', 'expiringDeals', 'tasks'].sort()
    );
  });

  // Every number on the dashboard is an aggregate, which is exactly the shape
  // of query where a missing userId is invisible — you get a plausible number,
  // just somebody else's.
  it('counts only the caller\'s rows in stats', async () => {
    const { alice, bob } = await createTwoUsers();
    await createTask(alice.id);
    await createTask(bob.id);
    await createTask(bob.id);
    await createEmail(alice.id, { isRead: false });
    await createEmail(bob.id, { isRead: false });

    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data.tasks.total).toBe(1);
    expect(res.body.data.emails.unreadCount).toBe(1);
    expect(res.body.data.emails.totalSynced).toBe(1);
  });

  it('returns the four sidebar badge counts, scoped to the caller', async () => {
    const { alice, bob } = await createTwoUsers();
    const yesterday = new Date(Date.now() - 86_400_000);
    const inAWeek = new Date(Date.now() + 7 * 86_400_000);

    for (const userId of [alice.id, bob.id]) {
      await createEmail(userId, { isRead: false });
      await prisma.task.create({
        data: { userId, title: 'Overdue', status: 'TODO', dueDate: yesterday },
      });
      await createEvent(userId, {
        startTime: new Date(),
        endTime: new Date(Date.now() + 3_600_000),
      });
      const partner = await createDealPartner(userId);
      await prisma.deal.create({
        data: { userId, partnerId: partner.id, title: 'Expiring', expiryDate: inAWeek },
      });
    }
    // A second row for Bob everywhere, so a leak shows up as a wrong number
    // rather than a coincidence.
    await createEmail(bob.id, { isRead: false });

    const res = await request(app)
      .get('/api/v1/dashboard/nav-counts')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      unreadEmails: 1,
      overdueTasks: 1,
      expiringDeals: 1,
      eventsToday: 1,
    });
  });
});

// ── Global search ────────────────────────────────────────────────────────────

describe('GET /api/v1/search', () => {
  it('returns every result bucket', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .get('/api/v1/search?q=anything')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(
      ['contacts', 'customers', 'deals', 'emails', 'events', 'tasks'].sort()
    );
  });

  it('returns nothing for a query under two characters', async () => {
    const { alice } = await createTwoUsers();
    await createTask(alice.id, { title: 'Quarterly report' });

    const res = await request(app).get('/api/v1/search?q=q').set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data.tasks).toEqual([]);
  });

  /**
   * Search is six parallel queries, every one of them a `userId` alongside an
   * `OR` of `contains` clauses — the precise construction that leaked in
   * dealService and emailService. A leak here hands one account a preview of
   * another's mail subjects from the header search box.
   */
  it('never surfaces another user\'s rows', async () => {
    const { alice, bob } = await createTwoUsers();
    const needle = 'zzconfidential';
    await createTask(bob.id, { title: `Task ${needle}` });
    await createEmail(bob.id, { subject: `Email ${needle}` });
    await createCustomer(bob.id, { name: `Customer ${needle}` });
    await createEvent(bob.id, { title: `Event ${needle}` });

    const res = await request(app)
      .get(`/api/v1/search?q=${needle}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      emails: [],
      tasks: [],
      events: [],
      customers: [],
      contacts: [],
      deals: [],
    });
  });

  it('finds the caller\'s own rows', async () => {
    const { alice } = await createTwoUsers();
    await createTask(alice.id, { title: 'Quarterly zzreport' });

    const res = await request(app)
      .get('/api/v1/search?q=zzreport')
      .set('Cookie', cookieFor(alice.id));

    expect(res.body.data.tasks).toHaveLength(1);
  });
});

// ── Notifications ────────────────────────────────────────────────────────────

describe('/api/v1/notifications', () => {
  it('lists only the caller\'s undismissed notifications, with pagination meta', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createNotification(alice.id, { title: 'Mine' });
    await createNotification(alice.id, { title: 'Dismissed', isDismissed: true });
    await createNotification(bob.id, { title: 'Theirs' });

    const res = await request(app).get('/api/v1/notifications').set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(mine.id);
    expect(res.body.meta).toMatchObject({ total: 1, page: 1 });
  });

  it('counts only the caller\'s unread notifications', async () => {
    const { alice, bob } = await createTwoUsers();
    await createNotification(alice.id);
    await createNotification(bob.id);
    await createNotification(bob.id);

    const res = await request(app)
      .get('/api/v1/notifications/count')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 1 });
  });

  /**
   * `markRead` is an `updateMany`, so it answers `{ success: true }` whether it
   * matched one row or none. The status code proves nothing here — only the
   * victim's row does.
   */
  it('cannot mark another user\'s notification read', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createNotification(bob.id);

    const res = await request(app)
      .patch(`/api/v1/notifications/${theirs.id}/read`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).isRead).toBe(
      false
    );
  });

  it('marks the caller\'s own notification read', async () => {
    // The negative case above cannot distinguish "refused" from "no-op": both
    // controllers return a fixed { success: true } and were proved to pass with
    // the service call removed entirely. This is the half that fails if the
    // route stops doing its job.
    const { alice } = await createTwoUsers();
    const mine = await createNotification(alice.id);

    const res = await request(app)
      .patch(`/api/v1/notifications/${mine.id}/read`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: mine.id } })).isRead).toBe(
      true
    );
  });

  it('dismisses the caller\'s own notification', async () => {
    const { alice } = await createTwoUsers();
    const mine = await createNotification(alice.id);

    const res = await request(app)
      .delete(`/api/v1/notifications/${mine.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: mine.id } })).isDismissed
    ).toBe(true);
  });

  it('cannot dismiss another user\'s notification', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createNotification(bob.id);

    await request(app)
      .delete(`/api/v1/notifications/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).isDismissed
    ).toBe(false);
  });

  it('read-all touches only the caller\'s notifications', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createNotification(alice.id);
    const theirs = await createNotification(bob.id);

    const res = await request(app)
      .post('/api/v1/notifications/read-all')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: mine.id } })).isRead).toBe(true);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).isRead).toBe(
      false
    );
  });

  it('dismiss-all touches only the caller\'s read notifications', async () => {
    const { alice, bob } = await createTwoUsers();
    const mineRead = await createNotification(alice.id, { isRead: true });
    const mineUnread = await createNotification(alice.id, { isRead: false });
    const theirsRead = await createNotification(bob.id, { isRead: true });

    const res = await request(app)
      .post('/api/v1/notifications/dismiss-all')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: mineRead.id } })).isDismissed
    ).toBe(true);
    // Unread ones survive — dismiss-all clears the ones you have seen.
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: mineUnread.id } })).isDismissed
    ).toBe(false);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: theirsRead.id } })).isDismissed
    ).toBe(false);
  });
});

// ── Audit log ────────────────────────────────────────────────────────────────

describe('/api/v1/audit-logs', () => {
  it('lists only the caller\'s entries, newest first, with meta', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createAuditLog(alice.id);
    await createAuditLog(bob.id);

    const res = await request(app).get('/api/v1/audit-logs').set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(mine.id);
    expect(res.body.meta).toMatchObject({ total: 1, page: 1 });
  });

  it('404s on another user\'s entry', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createAuditLog(bob.id, { subject: 'Acquisition terms' });

    const res = await request(app)
      .get(`/api/v1/audit-logs/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Acquisition terms');
  });

  it('returns the caller\'s own entry', async () => {
    const { alice } = await createTwoUsers();
    const mine = await createAuditLog(alice.id);

    const res = await request(app)
      .get(`/api/v1/audit-logs/${mine.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(mine.id);
  });

  /**
   * The audit search builds `where.OR` over the JSON details. The ownership
   * filter has to survive that assignment — this is the same construction that
   * leaked twice already, and the audit trail is the one table that records
   * every subject line the user ever sent.
   */
  it('keeps the search filter scoped to the caller', async () => {
    const { alice, bob } = await createTwoUsers();
    await createAuditLog(bob.id, { subject: 'zzacquisition terms' });
    await createAuditLog(alice.id, { subject: 'Weekly report' });

    const res = await request(app)
      .get('/api/v1/audit-logs?search=zzacquisition')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('filters by action without dropping the ownership filter', async () => {
    const { alice, bob } = await createTwoUsers();
    await createAuditLog(alice.id, { action: 'TASK_CREATED' });
    await createAuditLog(alice.id, { action: 'EMAIL_SENT' });
    await createAuditLog(bob.id, { action: 'TASK_CREATED' });

    const res = await request(app)
      .get('/api/v1/audit-logs?action=TASK_CREATED')
      .set('Cookie', cookieFor(alice.id));

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].user.id).toBe(alice.id);
  });
});

// ── Onboarding ───────────────────────────────────────────────────────────────

describe('/api/v1/onboarding', () => {
  it('reports the blocking gaps for a brand-new account', async () => {
    const { alice } = await createTwoUsers();

    const res = await request(app)
      .get('/api/v1/onboarding/status')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data.needsOnboarding).toBe(true);
    expect(res.body.data.blocking).toEqual(['taskStatuses', 'dealPartners']);
    expect(res.body.data.steps.googleConnected).toBe(false);
  });

  // The status counts must be the caller's own — otherwise a busy neighbour
  // makes a genuinely empty account look configured, and the new user lands on
  // a Kanban board with no columns.
  it('does not count another user\'s setup as the caller\'s', async () => {
    const { alice, bob } = await createTwoUsers();
    await createTaskStatus(bob.id, 'TODO');
    await createDealPartner(bob.id);

    const res = await request(app)
      .get('/api/v1/onboarding/status')
      .set('Cookie', cookieFor(alice.id));

    expect(res.body.data.steps.taskStatusCount).toBe(0);
    expect(res.body.data.steps.dealPartnerCount).toBe(0);
    expect(res.body.data.blocking).toEqual(['taskStatuses', 'dealPartners']);
  });

  it('seeds the default board columns for the caller only', async () => {
    const { alice, bob } = await createTwoUsers();

    const res = await request(app)
      .post('/api/v1/onboarding/task-statuses')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ created: 3, skipped: false });
    expect(await prisma.taskStatus.count({ where: { userId: alice.id } })).toBe(3);
    expect(await prisma.taskStatus.count({ where: { userId: bob.id } })).toBe(0);
  });

  it('does not top up a board that already has columns', async () => {
    const { alice } = await createTwoUsers();
    await createTaskStatus(alice.id, 'BACKLOG');

    const res = await request(app)
      .post('/api/v1/onboarding/task-statuses')
      .set('Cookie', cookieFor(alice.id));

    expect(res.body.data).toEqual({ created: 0, skipped: true });
    expect(await prisma.taskStatus.count({ where: { userId: alice.id } })).toBe(1);
  });

  it('completes, stays idempotent, and leaves other accounts alone', async () => {
    const { alice, bob } = await createTwoUsers();

    const first = await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Cookie', cookieFor(alice.id))
      .send({});
    const second = await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Cookie', cookieFor(alice.id))
      .send({});

    expect(first.status).toBe(200);
    expect(first.body.data.alreadyComplete).toBe(false);
    expect(second.body.data.alreadyComplete).toBe(true);
    expect(second.body.data.completedAt).toBe(first.body.data.completedAt);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).onboardingCompletedAt
    ).toBeNull();
  });

  it('resets only the caller\'s flag', async () => {
    const { alice, bob } = await createTwoUsers();
    await prisma.user.update({
      where: { id: bob.id },
      data: { onboardingCompletedAt: new Date() },
    });
    await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Cookie', cookieFor(alice.id))
      .send({});

    const res = await request(app)
      .post('/api/v1/onboarding/reset')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data.completedAt).toBeNull();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).onboardingCompletedAt
    ).not.toBeNull();
  });
});

// ── Templates ────────────────────────────────────────────────────────────────

describe('/api/v1/templates', () => {
  /**
   * `/variables` is a literal segment sharing a router with `/:id` routes. If
   * it ever stops resolving, Settings renders an empty placeholder list and
   * every variable a user types is then rejected at save time as unknown.
   */
  it('serves the placeholder catalogue at /variables', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .get('/api/v1/templates/variables')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data.map((v: { name: string }) => v.name)).toContain('firstName');
    for (const variable of res.body.data) {
      expect(Object.keys(variable).sort()).toEqual(['label', 'name', 'source']);
    }
  });

  it('lists only the caller\'s templates', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createTemplate(alice.id, { name: 'Mine' });
    await createTemplate(bob.id, { name: 'Theirs' });

    const res = await request(app).get('/api/v1/templates').set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(mine.id);
  });

  it('keeps the search filter scoped to the caller', async () => {
    const { alice, bob } = await createTwoUsers();
    await createTemplate(bob.id, { name: 'zzpricing sheet' });

    const res = await request(app)
      .get('/api/v1/templates?search=zzpricing')
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('creates a template owned by the caller', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .post('/api/v1/templates')
      .set('Cookie', cookieFor(alice.id))
      .send({ name: 'Intro', subject: 'Hello', body: 'Hi {{firstName}}' });

    expect(res.status).toBe(201);
    const stored = await prisma.emailTemplate.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(stored.userId).toBe(alice.id);
  });

  // An unknown placeholder is a message that goes out reading "Hi {{firstNmae}}".
  it('rejects a body using a placeholder the app cannot fill', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .post('/api/v1/templates')
      .set('Cookie', cookieFor(alice.id))
      .send({ name: 'Intro', body: 'Hi {{firstNmae}}' });

    expect(res.status).toBe(400);
  });

  it('cannot update another user\'s template', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createTemplate(bob.id, { name: 'Theirs', body: 'Original body' });

    const res = await request(app)
      .patch(`/api/v1/templates/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id))
      .send({ body: 'Hijacked body' });

    expect(res.status).toBe(404);
    const after = await prisma.emailTemplate.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.body).toBe('Original body');
  });

  it('cannot delete another user\'s template', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createTemplate(bob.id);

    const res = await request(app)
      .delete(`/api/v1/templates/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(404);
    expect(await prisma.emailTemplate.count({ where: { id: theirs.id } })).toBe(1);
  });

  it('cannot render another user\'s template', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createTemplate(bob.id, { body: 'Our internal zzpricing' });

    const res = await request(app)
      .post(`/api/v1/templates/${theirs.id}/render`)
      .set('Cookie', cookieFor(alice.id))
      .send({ recipientEmail: 'someone@example.com' });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('zzpricing');
  });

  it('renders the caller\'s own template', async () => {
    const { alice } = await createTwoUsers();
    const mine = await createTemplate(alice.id, { body: 'Hi {{firstName}}' });

    const res = await request(app)
      .post(`/api/v1/templates/${mine.id}/render`)
      .set('Cookie', cookieFor(alice.id))
      .send({ recipientEmail: 'jane@example.com', recipientName: 'Jane Doe' });

    expect(res.status).toBe(200);
    expect(res.body.data.body).toContain('Jane');
  });
});

// ── Snooze / follow-up reminders ─────────────────────────────────────────────

describe('/api/v1/snooze', () => {
  it('lists only the caller\'s armed reminders', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createReminder(alice.id, 'thread-mine');
    await createReminder(alice.id, 'thread-old', { state: 'fired' });
    await createReminder(bob.id, 'thread-theirs');

    const res = await request(app).get('/api/v1/snooze').set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(mine.id);
  });

  it('arms a reminder on a thread the caller owns', async () => {
    const { alice } = await createTwoUsers();
    const email = await createEmail(alice.id, { threadId: 'thread-1' });

    const res = await request(app)
      .post('/api/v1/snooze')
      .set('Cookie', cookieFor(alice.id))
      .send({
        threadId: email.threadId,
        kind: 'snooze',
        remindAt: new Date(Date.now() + 86_400_000).toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.data.state).toBe('armed');
  });

  /**
   * Ownership is decided by whether the caller has their OWN messages in the
   * thread. Gmail thread ids are shared strings — two people on the same thread
   * see the same id — so without that check, snoozing would move labels in
   * somebody else's mailbox.
   */
  it('404s on snoozing a thread the caller has no messages in', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(bob.id, { threadId: 'thread-theirs' });

    const res = await request(app)
      .post('/api/v1/snooze')
      .set('Cookie', cookieFor(alice.id))
      .send({
        threadId: 'thread-theirs',
        kind: 'snooze',
        remindAt: new Date(Date.now() + 86_400_000).toISOString(),
      });

    expect(res.status).toBe(404);
    expect(await prisma.emailReminder.count()).toBe(0);
  });

  it('rejects a remindAt in the past', async () => {
    const { alice } = await createTwoUsers();
    const email = await createEmail(alice.id, { threadId: 'thread-1' });

    const res = await request(app)
      .post('/api/v1/snooze')
      .set('Cookie', cookieFor(alice.id))
      .send({
        threadId: email.threadId,
        kind: 'snooze',
        remindAt: new Date(Date.now() - 1000).toISOString(),
      });

    expect(res.status).toBe(400);
  });

  it('rejects an unknown reminder kind', async () => {
    const { alice } = await createTwoUsers();
    const email = await createEmail(alice.id, { threadId: 'thread-1' });

    const res = await request(app)
      .post('/api/v1/snooze')
      .set('Cookie', cookieFor(alice.id))
      .send({
        threadId: email.threadId,
        kind: 'nap',
        remindAt: new Date(Date.now() + 86_400_000).toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // Cancelling somebody else's snooze would drop their thread back into their
  // inbox at a time they did not choose.
  it('cannot cancel another user\'s reminder', async () => {
    const { alice, bob } = await createTwoUsers();
    const theirs = await createReminder(bob.id, 'thread-theirs');

    const res = await request(app)
      .delete(`/api/v1/snooze/${theirs.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(404);
    expect((await prisma.emailReminder.findUniqueOrThrow({ where: { id: theirs.id } })).state).toBe(
      'armed'
    );
  });

  it('cancels the caller\'s own reminder', async () => {
    const { alice } = await createTwoUsers();
    const mine = await createReminder(alice.id, 'thread-mine');

    const res = await request(app)
      .delete(`/api/v1/snooze/${mine.id}`)
      .set('Cookie', cookieFor(alice.id));

    expect(res.status).toBe(200);
    expect((await prisma.emailReminder.findUniqueOrThrow({ where: { id: mine.id } })).state).toBe(
      'cancelled'
    );
  });
});
