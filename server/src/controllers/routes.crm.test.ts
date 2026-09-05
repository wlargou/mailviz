import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { Test } from 'supertest';
import { app } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { signAccessToken } from '../utils/jwt.js';
import {
  createTwoUsers,
  createUser,
  createCustomer,
  createContact,
  createTask,
  createDeal,
  createDealPartner,
  createEmail,
  shareDealWith,
  shareTaskWith,
  seedTaskStatuses,
} from '../test/factories.js';

/**
 * Route-level coverage for the CRM surface: contacts, customers, deals, tasks
 * and their sub-routes.
 *
 * The service tests cover the query logic. What only an HTTP test can cover is
 * everything between the socket and the service: that the router is actually
 * mounted behind `requireAuth`, that the controller wraps the result in the
 * envelope the client parses, that a service `AppError` arrives as a status
 * rather than a 500 — and, above all, that the tenant boundary the services
 * enforce survives the id arriving as a URL segment instead of a function
 * argument.
 *
 * Every `:id` route is therefore exercised twice: once with the caller's own
 * id, and once with another user's. The second must answer 404 and must never
 * contain that user's data. Where a filter is documented (contacts take `kind`
 * and `engagement`), an unrecognised value must be ignored — not rejected, and
 * not silently turned into an empty list.
 */

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

interface ErrorBody {
  error: { code: string; message: string };
}
interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
interface ListBody<T> {
  data: T[];
  meta: PageMeta;
}
interface ItemBody<T> {
  data: T;
}
interface IdRow {
  id: string;
}
interface ContactRow extends IdRow {
  firstName: string;
  lastName: string;
  email: string | null;
  role: string | null;
  kind: string;
  engagement: string;
  isVip: boolean;
}
interface CustomerRow extends IdRow {
  name: string;
  isVip: boolean;
}
interface DealRow extends IdRow {
  title: string;
  status: string;
  partner: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
}
interface TaskRow extends IdRow {
  title: string;
  status: string;
  position: number;
  customerId: string | null;
  assignedToId: string | null;
}
interface ShareRow {
  sharedWith: { id: string; email: string };
}
interface DuplicateGroupRow {
  contacts: IdRow[];
}
interface TaskSummary {
  total: number;
  completed: number;
  overdue: number;
  inProgress: number;
  byPriority: Record<string, number>;
}
interface AttachmentRow extends IdRow {
  filename: string;
}
interface EventRow extends IdRow {
  title: string;
}

const authFor = (userId: string) => [`access_token=${signAccessToken(userId)}`];

function call(method: HttpMethod, path: string): Test {
  const agent = request(app);
  switch (method) {
    case 'get':
      return agent.get(path);
    case 'post':
      return agent.post(path);
    case 'patch':
      return agent.patch(path);
    case 'delete':
      return agent.delete(path);
  }
}

const ids = (rows: IdRow[]) => rows.map((r) => r.id).sort();

/**
 * `factories.createContact` does not take `kind`/`engagement`, and the factory
 * file is shared, so the filter fixtures are built here.
 */
let localSeq = 0;
async function seedContact(
  customerId: string,
  overrides: Partial<{
    firstName: string;
    lastName: string;
    email: string;
    kind: string;
    engagement: string;
    role: string;
  }> = {}
) {
  const n = ++localSeq;
  return prisma.contact.create({
    data: {
      customerId,
      firstName: overrides.firstName ?? 'Seed',
      lastName: overrides.lastName ?? `Contact-${n}`,
      email: overrides.email ?? `seed-${n}-${Date.now()}@example.com`,
      ...(overrides.kind ? { kind: overrides.kind } : {}),
      ...(overrides.engagement ? { engagement: overrides.engagement } : {}),
      ...(overrides.role ? { role: overrides.role } : {}),
    },
  });
}

async function seedAttachment(emailId: string, filename: string) {
  return prisma.emailAttachment.create({
    data: { emailId, gmailAttachmentId: `att-${++localSeq}`, filename, mimeType: 'text/plain', size: 12 },
  });
}

async function seedEventForCustomer(userId: string, customerId: string, title: string, attendee?: string) {
  const event = await prisma.calendarEvent.create({
    data: {
      userId,
      title,
      startTime: new Date('2026-01-01T10:00:00Z'),
      endTime: new Date('2026-01-01T11:00:00Z'),
      ...(attendee ? { attendees: [{ email: attendee }] } : {}),
    },
  });
  await prisma.calendarEventCustomer.create({ data: { calendarEventId: event.id, customerId } });
  return event;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * A route added to a router but hung off an unprotected `app.use` is invisible
 * in every service test — the service still checks ownership, but the caller
 * never had to be anybody. This table is the guard against that, so it lists
 * every method/path pair the four CRM routers expose.
 */
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000001';
const PROTECTED_ROUTES: Array<[HttpMethod, string]> = [
  ['get', '/api/v1/contacts'],
  ['get', '/api/v1/contacts/lookup?email=someone%40example.com'],
  ['get', '/api/v1/contacts/duplicates'],
  ['post', '/api/v1/contacts/merge'],
  ['get', `/api/v1/contacts/${PLACEHOLDER_ID}`],
  ['get', `/api/v1/contacts/${PLACEHOLDER_ID}/attachments`],
  ['get', `/api/v1/contacts/${PLACEHOLDER_ID}/events`],
  ['post', '/api/v1/contacts'],
  ['patch', `/api/v1/contacts/${PLACEHOLDER_ID}/vip`],
  ['patch', `/api/v1/contacts/${PLACEHOLDER_ID}`],
  ['delete', `/api/v1/contacts/${PLACEHOLDER_ID}`],

  ['get', '/api/v1/customers'],
  ['get', `/api/v1/customers/${PLACEHOLDER_ID}`],
  ['get', `/api/v1/customers/${PLACEHOLDER_ID}/attachments`],
  ['get', `/api/v1/customers/${PLACEHOLDER_ID}/events`],
  ['post', '/api/v1/customers'],
  ['patch', `/api/v1/customers/${PLACEHOLDER_ID}/vip`],
  ['patch', `/api/v1/customers/${PLACEHOLDER_ID}`],
  ['delete', `/api/v1/customers/${PLACEHOLDER_ID}`],

  ['get', '/api/v1/deals'],
  ['get', `/api/v1/deals/${PLACEHOLDER_ID}`],
  ['post', '/api/v1/deals'],
  ['patch', `/api/v1/deals/${PLACEHOLDER_ID}`],
  ['delete', `/api/v1/deals/${PLACEHOLDER_ID}`],
  ['post', `/api/v1/deals/${PLACEHOLDER_ID}/share`],
  ['get', `/api/v1/deals/${PLACEHOLDER_ID}/shares`],
  ['delete', `/api/v1/deals/${PLACEHOLDER_ID}/shares/${PLACEHOLDER_ID}`],

  ['get', '/api/v1/tasks'],
  ['get', '/api/v1/tasks/summary'],
  ['get', `/api/v1/tasks/${PLACEHOLDER_ID}`],
  ['post', '/api/v1/tasks'],
  ['patch', '/api/v1/tasks/reorder'],
  ['patch', `/api/v1/tasks/${PLACEHOLDER_ID}`],
  ['delete', `/api/v1/tasks/${PLACEHOLDER_ID}`],
  ['post', `/api/v1/tasks/${PLACEHOLDER_ID}/share`],
  ['get', `/api/v1/tasks/${PLACEHOLDER_ID}/shares`],
  ['delete', `/api/v1/tasks/${PLACEHOLDER_ID}/shares/${PLACEHOLDER_ID}`],
  ['patch', `/api/v1/tasks/${PLACEHOLDER_ID}/assign`],
];

describe('CRM routes — authentication', () => {
  it.each(PROTECTED_ROUTES)('%s %s answers 401 without a session', async (method, path) => {
    const res = await call(method, path).send({});
    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    // A handler that ran anyway and only *then* noticed would still have
    // produced a payload; nothing may come back but the error.
    expect(res.body).not.toHaveProperty('data');
  });

  it('rejects a well-formed token whose user no longer exists', async () => {
    // The token verifies — only the database lookup in `requireAuth` catches
    // this. Deleting an account has to end its sessions.
    const ghost = await createUser();
    const cookie = authFor(ghost.id);
    await prisma.user.delete({ where: { id: ghost.id } });

    const res = await request(app).get('/api/v1/tasks').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const { alice } = await createTwoUsers();
    const good = signAccessToken(alice.id);
    const forged = `${good.slice(0, -3)}xyz`;

    const res = await request(app).get('/api/v1/tasks').set('Cookie', [`access_token=${forged}`]);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

describe('GET /api/v1/contacts', () => {
  it('returns the caller\'s contacts in a { data, meta } envelope', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCo = await createCustomer(alice.id);
    const bobCo = await createCustomer(bob.id);
    const mine = [await seedContact(aliceCo.id), await seedContact(aliceCo.id)];
    await seedContact(bobCo.id, { lastName: 'BobsSecretContact' });

    const res = await request(app).get('/api/v1/contacts').set('Cookie', authFor(alice.id));

    expect(res.status).toBe(200);
    const body = res.body as ListBody<ContactRow>;
    expect(ids(body.data)).toEqual(ids(mine));
    expect(body.meta).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
    expect(JSON.stringify(body)).not.toContain('BobsSecretContact');
  });

  it('honours page and limit', async () => {
    const { alice } = await createTwoUsers();
    const co = await createCustomer(alice.id);
    await seedContact(co.id, { lastName: 'Aaa' });
    await seedContact(co.id, { lastName: 'Bbb' });
    await seedContact(co.id, { lastName: 'Ccc' });

    const cookie = authFor(alice.id);
    const p1 = await request(app).get('/api/v1/contacts?page=1&limit=2&sortBy=lastName&sortOrder=asc').set('Cookie', cookie);
    const p2 = await request(app).get('/api/v1/contacts?page=2&limit=2&sortBy=lastName&sortOrder=asc').set('Cookie', cookie);

    const b1 = p1.body as ListBody<ContactRow>;
    const b2 = p2.body as ListBody<ContactRow>;
    expect(b1.data).toHaveLength(2);
    expect(b2.data).toHaveLength(1);
    expect(b1.meta).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(b2.meta).toMatchObject({ page: 2, limit: 2, total: 3 });
    // Pages must partition the set, not overlap it.
    expect(ids(b1.data).concat(ids(b2.data))).toHaveLength(3);
    expect(new Set(ids(b1.data).concat(ids(b2.data))).size).toBe(3);
  });

  it('searches within the caller and never across users', async () => {
    // `contactService.findAll` assigns `where.OR` for search while ownership
    // sits on `where.customer`. If a refactor ever moves ownership onto `OR`,
    // this is the request that starts returning another account's address book.
    const { alice, bob } = await createTwoUsers();
    const aliceCo = await createCustomer(alice.id);
    const bobCo = await createCustomer(bob.id);
    await seedContact(aliceCo.id, { lastName: 'Nomatch' });
    const hit = await seedContact(aliceCo.id, { lastName: 'Zephyrine' });
    await seedContact(bobCo.id, { lastName: 'Zephyrine' });

    const res = await request(app).get('/api/v1/contacts?search=Zephyrine').set('Cookie', authFor(alice.id));

    const body = res.body as ListBody<ContactRow>;
    expect(ids(body.data)).toEqual([hit.id]);
    expect(body.meta.total).toBe(1);
  });

  // The kind/engagement filters exist twice in the service: once as a Prisma
  // `where` and once as raw SQL for the default `emailCount` sort. Both branches
  // are reachable from the same URL, so both are exercised — a fix applied to
  // one and not the other is exactly the sort of drift this catches.
  describe.each([
    ['default sort (raw SQL branch)', ''],
    ['sortBy=lastName (Prisma branch)', '&sortBy=lastName'],
  ])('kind / engagement filters — %s', (_label, sortSuffix) => {
    async function seedKinds() {
      const { alice } = await createTwoUsers();
      const co = await createCustomer(alice.id);
      const person = await seedContact(co.id, { kind: 'person', engagement: 'both' });
      const role = await seedContact(co.id, { kind: 'role', engagement: 'sender' });
      const automated = await seedContact(co.id, { kind: 'automated', engagement: 'none' });
      return { alice, person, role, automated };
    }

    it('kind=person returns only people', async () => {
      const { alice, person } = await seedKinds();
      const res = await request(app).get(`/api/v1/contacts?kind=person${sortSuffix}`).set('Cookie', authFor(alice.id));
      expect(ids((res.body as ListBody<ContactRow>).data)).toEqual([person.id]);
    });

    it('kind=people widens to person + role but still excludes machines', async () => {
      const { alice, person, role } = await seedKinds();
      const res = await request(app).get(`/api/v1/contacts?kind=people${sortSuffix}`).set('Cookie', authFor(alice.id));
      expect(ids((res.body as ListBody<ContactRow>).data)).toEqual(ids([person, role]));
    });

    it('ignores an unrecognised kind rather than erroring or emptying the list', async () => {
      // A stale bookmark or a renamed filter must not blank the contact list,
      // and must not 400 either — the value is simply not a filter.
      const { alice, person, role, automated } = await seedKinds();
      const res = await request(app).get(`/api/v1/contacts?kind=banana${sortSuffix}`).set('Cookie', authFor(alice.id));
      expect(res.status).toBe(200);
      const body = res.body as ListBody<ContactRow>;
      expect(ids(body.data)).toEqual(ids([person, role, automated]));
      expect(body.meta.total).toBe(3);
    });

    it('engagement=sender returns only contacts who have written in', async () => {
      const { alice, role } = await seedKinds();
      const res = await request(app).get(`/api/v1/contacts?engagement=sender${sortSuffix}`).set('Cookie', authFor(alice.id));
      expect(ids((res.body as ListBody<ContactRow>).data)).toEqual([role.id]);
    });

    it('engagement=any excludes only the never-engaged', async () => {
      const { alice, person, role } = await seedKinds();
      const res = await request(app).get(`/api/v1/contacts?engagement=any${sortSuffix}`).set('Cookie', authFor(alice.id));
      expect(ids((res.body as ListBody<ContactRow>).data)).toEqual(ids([person, role]));
    });

    it('ignores an unrecognised engagement rather than erroring or emptying the list', async () => {
      const { alice, person, role, automated } = await seedKinds();
      const res = await request(app)
        .get(`/api/v1/contacts?engagement=sometimes${sortSuffix}`)
        .set('Cookie', authFor(alice.id));
      expect(res.status).toBe(200);
      const body = res.body as ListBody<ContactRow>;
      expect(ids(body.data)).toEqual(ids([person, role, automated]));
      expect(body.meta.total).toBe(3);
    });

    it('combines kind and engagement', async () => {
      const { alice, person } = await seedKinds();
      const res = await request(app)
        .get(`/api/v1/contacts?kind=people&engagement=both${sortSuffix}`)
        .set('Cookie', authFor(alice.id));
      expect(ids((res.body as ListBody<ContactRow>).data)).toEqual([person.id]);
    });

    it('customerId narrows to one company and cannot reach another user\'s', async () => {
      const { alice, bob } = await createTwoUsers();
      const aliceCo = await createCustomer(alice.id);
      const otherCo = await createCustomer(alice.id);
      const bobCo = await createCustomer(bob.id);
      const mine = await seedContact(aliceCo.id);
      await seedContact(otherCo.id);
      await seedContact(bobCo.id, { lastName: 'BobsSecretContact' });

      const cookie = authFor(alice.id);
      const own = await request(app).get(`/api/v1/contacts?customerId=${aliceCo.id}${sortSuffix}`).set('Cookie', cookie);
      expect(ids((own.body as ListBody<ContactRow>).data)).toEqual([mine.id]);

      const foreign = await request(app).get(`/api/v1/contacts?customerId=${bobCo.id}${sortSuffix}`).set('Cookie', cookie);
      expect(foreign.status).toBe(200);
      expect((foreign.body as ListBody<ContactRow>).data).toEqual([]);
      expect(JSON.stringify(foreign.body)).not.toContain('BobsSecretContact');
    });
  });
});

describe('contact :id routes', () => {
  it('GET /:id returns the contact for its owner', async () => {
    const { alice } = await createTwoUsers();
    const co = await createCustomer(alice.id);
    const contact = await seedContact(co.id, { firstName: 'Ada' });

    const res = await request(app).get(`/api/v1/contacts/${contact.id}`).set('Cookie', authFor(alice.id));
    expect(res.status).toBe(200);
    expect((res.body as ItemBody<ContactRow>).data.id).toBe(contact.id);
  });

  it('GET /:id is 404 for another user\'s contact and returns none of it', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCo = await createCustomer(bob.id, { name: 'BobsSecretCorp' });
    const contact = await seedContact(bobCo.id, { firstName: 'BobsSecretContact', email: 'bobsecret@example.com' });

    const res = await request(app).get(`/api/v1/contacts/${contact.id}`).set('Cookie', authFor(alice.id));
    expect(res.status).toBe(404);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('BobsSecretContact');
    expect(serialised).not.toContain('bobsecret@example.com');
    expect(serialised).not.toContain('BobsSecretCorp');
  });

  it('GET /:id/attachments returns the contact\'s files, and 404s across users', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCo = await createCustomer(alice.id);
    const aliceContact = await seedContact(aliceCo.id, { email: 'ada@alice.example.com' });
    const aliceEmail = await createEmail(alice.id, { from: 'ada@alice.example.com' });
    await seedAttachment(aliceEmail.id, 'alice-invoice.pdf');

    const bobCo = await createCustomer(bob.id);
    const bobContact = await seedContact(bobCo.id, { email: 'bob@bob.example.com' });
    const bobEmail = await createEmail(bob.id, { from: 'bob@bob.example.com' });
    await seedAttachment(bobEmail.id, 'bobs-secret-contract.pdf');

    const cookie = authFor(alice.id);
    const own = await request(app).get(`/api/v1/contacts/${aliceContact.id}/attachments`).set('Cookie', cookie);
    expect(own.status).toBe(200);
    expect((own.body as ListBody<AttachmentRow>).data.map((a) => a.filename)).toEqual(['alice-invoice.pdf']);

    const foreign = await request(app).get(`/api/v1/contacts/${bobContact.id}/attachments`).set('Cookie', cookie);
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(foreign.body)).not.toContain('bobs-secret-contract.pdf');
  });

  it('GET /:id/events returns the contact\'s meetings, and 404s across users', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCo = await createCustomer(alice.id);
    const aliceContact = await seedContact(aliceCo.id, { email: 'ada@alice.example.com' });
    await seedEventForCustomer(alice.id, aliceCo.id, 'Alice kickoff', 'ada@alice.example.com');

    const bobCo = await createCustomer(bob.id);
    const bobContact = await seedContact(bobCo.id, { email: 'bob@bob.example.com' });
    await seedEventForCustomer(bob.id, bobCo.id, 'BobsSecretMeeting', 'bob@bob.example.com');

    const cookie = authFor(alice.id);
    const own = await request(app).get(`/api/v1/contacts/${aliceContact.id}/events`).set('Cookie', cookie);
    expect(own.status).toBe(200);
    expect((own.body as ListBody<EventRow>).data.map((e) => e.title)).toEqual(['Alice kickoff']);

    const foreign = await request(app).get(`/api/v1/contacts/${bobContact.id}/events`).set('Cookie', cookie);
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(foreign.body)).not.toContain('BobsSecretMeeting');
  });

  it('PATCH /:id updates the caller\'s contact and leaves another user\'s untouched', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCo = await createCustomer(alice.id);
    const mine = await seedContact(aliceCo.id, { role: 'Engineer' });
    const bobCo = await createCustomer(bob.id);
    const theirs = await seedContact(bobCo.id, { firstName: 'BobsSecretContact' });

    const cookie = authFor(alice.id);
    const ok = await request(app).patch(`/api/v1/contacts/${mine.id}`).set('Cookie', cookie).send({ role: 'CTO' });
    expect(ok.status).toBe(200);
    expect((ok.body as ItemBody<ContactRow>).data.id).toBe(mine.id);
    // The new value, in the response *and* in the row. Asserting only the id
    // passed against a handler that skipped the write and echoed the record it
    // had just read.
    expect((ok.body as ItemBody<ContactRow>).data.role).toBe('CTO');
    expect((await prisma.contact.findUnique({ where: { id: mine.id } }))?.role).toBe('CTO');

    const denied = await request(app)
      .patch(`/api/v1/contacts/${theirs.id}`)
      .set('Cookie', cookie)
      .send({ firstName: 'Hijacked' });
    expect(denied.status).toBe(404);
    const after = await prisma.contact.findUnique({ where: { id: theirs.id } });
    expect(after?.firstName).toBe('BobsSecretContact');
  });

  it('PATCH /:id/vip toggles for the owner and refuses across users', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCo = await createCustomer(alice.id);
    const mine = await seedContact(aliceCo.id);
    const bobCo = await createCustomer(bob.id);
    const theirs = await seedContact(bobCo.id);

    const cookie = authFor(alice.id);
    const ok = await request(app).patch(`/api/v1/contacts/${mine.id}/vip`).set('Cookie', cookie).send({});
    expect(ok.status).toBe(200);
    expect((ok.body as ItemBody<ContactRow>).data.isVip).toBe(true);

    // Back again. One call from a default-false row proves nothing about
    // toggling — `data: { isVip: true }` hardcoded passes it — so the second
    // call is where the word "toggles" is earned.
    const off = await request(app).patch(`/api/v1/contacts/${mine.id}/vip`).set('Cookie', cookie).send({});
    expect((off.body as ItemBody<ContactRow>).data.isVip).toBe(false);
    expect((await prisma.contact.findUnique({ where: { id: mine.id } }))?.isVip).toBe(false);

    const denied = await request(app).patch(`/api/v1/contacts/${theirs.id}/vip`).set('Cookie', cookie).send({});
    expect(denied.status).toBe(404);
    // The controller flips a boolean it read moments earlier; if the ownership
    // filter went missing the write would land before anyone noticed.
    expect((await prisma.contact.findUnique({ where: { id: theirs.id } }))?.isVip).toBe(false);
  });

  it('DELETE /:id removes the caller\'s contact and refuses another user\'s', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCo = await createCustomer(alice.id);
    const mine = await seedContact(aliceCo.id);
    const bobCo = await createCustomer(bob.id);
    const theirs = await seedContact(bobCo.id);

    const cookie = authFor(alice.id);
    const ok = await request(app).delete(`/api/v1/contacts/${mine.id}`).set('Cookie', cookie);
    expect(ok.status).toBe(204);
    expect(await prisma.contact.findUnique({ where: { id: mine.id } })).toBeNull();

    const denied = await request(app).delete(`/api/v1/contacts/${theirs.id}`).set('Cookie', cookie);
    expect(denied.status).toBe(404);
    expect(await prisma.contact.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });

  it('answers 404 rather than crashing on an id that is not a uuid', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app).get('/api/v1/contacts/not-a-uuid').set('Cookie', authFor(alice.id));
    expect(res.status).toBe(404);
  });
});

describe('contact collection routes', () => {
  it('POST /api/v1/contacts creates under the caller\'s company', async () => {
    const { alice } = await createTwoUsers();
    const co = await createCustomer(alice.id);

    const res = await request(app)
      .post('/api/v1/contacts')
      .set('Cookie', authFor(alice.id))
      .send({ firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com', customerId: co.id });

    expect(res.status).toBe(201);
    const created = (res.body as ItemBody<ContactRow>).data;
    expect(created.firstName).toBe('Grace');
    const row = await prisma.contact.findUnique({ where: { id: created.id } });
    expect(row?.customerId).toBe(co.id);
  });

  it('POST /api/v1/contacts refuses another user\'s customerId', async () => {
    // Otherwise a contact lands inside someone else's company — visible to them
    // on their company page, invisible to the account that created it.
    const { alice, bob } = await createTwoUsers();
    const bobCo = await createCustomer(bob.id);

    const res = await request(app)
      .post('/api/v1/contacts')
      .set('Cookie', authFor(alice.id))
      .send({ firstName: 'Trojan', lastName: 'Horse', customerId: bobCo.id });

    expect(res.status).toBe(404);
    expect(await prisma.contact.count({ where: { customerId: bobCo.id } })).toBe(0);
  });

  it('POST /api/v1/contacts rejects a malformed body with 400', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .post('/api/v1/contacts')
      .set('Cookie', authFor(alice.id))
      .send({ lastName: 'NoFirstName', customerId: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /lookup finds the caller\'s contact by address and nobody else\'s', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCo = await createCustomer(alice.id);
    const mine = await seedContact(aliceCo.id, { email: 'shared-address@example.com' });
    const bobCo = await createCustomer(bob.id);
    await seedContact(bobCo.id, { email: 'bobs-only@example.com', firstName: 'BobsSecretContact' });

    const cookie = authFor(alice.id);
    const hit = await request(app).get('/api/v1/contacts/lookup?email=shared-address@example.com').set('Cookie', cookie);
    expect(hit.status).toBe(200);
    expect((hit.body as ItemBody<ContactRow | null>).data?.id).toBe(mine.id);

    const miss = await request(app).get('/api/v1/contacts/lookup?email=bobs-only@example.com').set('Cookie', cookie);
    expect(miss.status).toBe(200);
    expect((miss.body as ItemBody<ContactRow | null>).data).toBeNull();
    expect(JSON.stringify(miss.body)).not.toContain('BobsSecretContact');
  });

  it('GET /lookup without an email is a 400', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app).get('/api/v1/contacts/lookup').set('Cookie', authFor(alice.id));
    expect(res.status).toBe(400);
  });

  it('GET /duplicates proposes only the caller\'s duplicates', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCo = await createCustomer(alice.id);
    const a1 = await seedContact(aliceCo.id, { firstName: 'Ada', lastName: 'Lovelace', email: 'dupe@alice.example.com' });
    const a2 = await seedContact(aliceCo.id, { firstName: 'Ada', lastName: 'Lovelace', email: 'dupe@alice.example.com' });
    const bobCo = await createCustomer(bob.id);
    await seedContact(bobCo.id, { firstName: 'BobsSecretContact', lastName: 'Dup', email: 'dupe@bob.example.com' });
    await seedContact(bobCo.id, { firstName: 'BobsSecretContact', lastName: 'Dup', email: 'dupe@bob.example.com' });

    const res = await request(app).get('/api/v1/contacts/duplicates').set('Cookie', authFor(alice.id));

    expect(res.status).toBe(200);
    const body = res.body as ListBody<DuplicateGroupRow>;
    expect(body.data).toHaveLength(1);
    expect(ids(body.data[0].contacts)).toEqual(ids([a1, a2]));
    expect(JSON.stringify(body)).not.toContain('BobsSecretContact');
  });

  it('POST /merge folds the caller\'s own contacts together', async () => {
    const { alice } = await createTwoUsers();
    const co = await createCustomer(alice.id);
    const target = await seedContact(co.id, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@alice.example.com' });
    const source = await seedContact(co.id, { firstName: 'Ada', lastName: 'Lovelace', email: 'a.lovelace@alice.example.com' });

    const res = await request(app)
      .post('/api/v1/contacts/merge')
      .set('Cookie', authFor(alice.id))
      .send({ targetId: target.id, sourceIds: [source.id] });

    expect(res.status).toBe(200);
    expect((res.body as ItemBody<{ mergedContactIds: string[] }>).data.mergedContactIds).toEqual([source.id]);
    expect(await prisma.contact.findUnique({ where: { id: source.id } })).toBeNull();
  });

  it('POST /merge cannot destroy another user\'s contacts', async () => {
    // A merge deletes rows irreversibly. Reaching one across the tenant
    // boundary would be data loss with no undo, so it must not resolve at all.
    const { alice, bob } = await createTwoUsers();
    const aliceCo = await createCustomer(alice.id);
    const mine = await seedContact(aliceCo.id);
    const bobCo = await createCustomer(bob.id);
    const theirs = await seedContact(bobCo.id);

    const res = await request(app)
      .post('/api/v1/contacts/merge')
      .set('Cookie', authFor(alice.id))
      .send({ targetId: mine.id, sourceIds: [theirs.id] });

    expect(res.status).toBe(404);
    expect(await prisma.contact.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

describe('/api/v1/customers', () => {
  it('GET / lists only the caller\'s companies with pagination meta', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = [await createCustomer(alice.id), await createCustomer(alice.id)];
    await createCustomer(bob.id, { name: 'BobsSecretCorp' });

    const res = await request(app).get('/api/v1/customers').set('Cookie', authFor(alice.id));
    expect(res.status).toBe(200);
    const body = res.body as ListBody<CustomerRow>;
    expect(ids(body.data)).toEqual(ids(mine));
    expect(body.meta).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
    expect(JSON.stringify(body)).not.toContain('BobsSecretCorp');
  });

  it('GET / honours page and limit', async () => {
    const { alice } = await createTwoUsers();
    await createCustomer(alice.id, { name: 'Aaa' });
    await createCustomer(alice.id, { name: 'Bbb' });
    await createCustomer(alice.id, { name: 'Ccc' });

    const cookie = authFor(alice.id);
    const p1 = await request(app).get('/api/v1/customers?page=1&limit=2&sortBy=name&sortOrder=asc').set('Cookie', cookie);
    const p2 = await request(app).get('/api/v1/customers?page=2&limit=2&sortBy=name&sortOrder=asc').set('Cookie', cookie);

    const b1 = p1.body as ListBody<CustomerRow>;
    const b2 = p2.body as ListBody<CustomerRow>;
    expect(b1.data.map((c) => c.name)).toEqual(['Aaa', 'Bbb']);
    expect(b2.data.map((c) => c.name)).toEqual(['Ccc']);
    expect(b1.meta).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
  });

  it('GET /?search= never reaches another user\'s companies', async () => {
    const { alice, bob } = await createTwoUsers();
    const hit = await createCustomer(alice.id, { name: 'Zephyrine Ltd' });
    await createCustomer(bob.id, { name: 'Zephyrine GmbH' });

    const res = await request(app).get('/api/v1/customers?search=Zephyrine').set('Cookie', authFor(alice.id));
    const body = res.body as ListBody<CustomerRow>;
    expect(ids(body.data)).toEqual([hit.id]);
    expect(JSON.stringify(body)).not.toContain('GmbH');
  });

  it('GET /:id returns the company for its owner and 404s across users', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createCustomer(alice.id);
    const theirs = await createCustomer(bob.id, { name: 'BobsSecretCorp' });

    const cookie = authFor(alice.id);
    const ok = await request(app).get(`/api/v1/customers/${mine.id}`).set('Cookie', cookie);
    expect(ok.status).toBe(200);
    expect((ok.body as ItemBody<CustomerRow>).data.id).toBe(mine.id);

    const denied = await request(app).get(`/api/v1/customers/${theirs.id}`).set('Cookie', cookie);
    expect(denied.status).toBe(404);
    expect(JSON.stringify(denied.body)).not.toContain('BobsSecretCorp');
  });

  it('GET /:id/attachments returns the company\'s files and none of another user\'s', async () => {
    // `customerService.findAttachments` scopes through `email.customer.userId`
    // rather than a 404, so the only thing standing between Alice and Bob's
    // files is that one nested filter. This is the request that proves it.
    const { alice, bob } = await createTwoUsers();
    const aliceCo = await createCustomer(alice.id);
    const aliceEmail = await createEmail(alice.id, { customerId: aliceCo.id });
    await seedAttachment(aliceEmail.id, 'alice-quote.pdf');

    const bobCo = await createCustomer(bob.id);
    const bobEmail = await createEmail(bob.id, { customerId: bobCo.id });
    await seedAttachment(bobEmail.id, 'bobs-secret-contract.pdf');

    const cookie = authFor(alice.id);
    const own = await request(app).get(`/api/v1/customers/${aliceCo.id}/attachments`).set('Cookie', cookie);
    expect(own.status).toBe(200);
    expect((own.body as ListBody<AttachmentRow>).data.map((a) => a.filename)).toEqual(['alice-quote.pdf']);

    const foreign = await request(app).get(`/api/v1/customers/${bobCo.id}/attachments`).set('Cookie', cookie);
    // Assert the status before the body. Without it any non-200 shows up only
    // as `data: undefined`, which reports a server error as though the shape
    // were wrong — this test failed exactly once that way and said nothing
    // about why.
    expect(foreign.status).toBe(200);
    expect((foreign.body as ListBody<AttachmentRow>).data).toEqual([]);
    expect(JSON.stringify(foreign.body)).not.toContain('bobs-secret-contract.pdf');
  });

  it('GET /:id/events returns the company\'s meetings and none of another user\'s', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCo = await createCustomer(alice.id);
    await seedEventForCustomer(alice.id, aliceCo.id, 'Alice review');
    const bobCo = await createCustomer(bob.id);
    await seedEventForCustomer(bob.id, bobCo.id, 'BobsSecretMeeting');

    const cookie = authFor(alice.id);
    const own = await request(app).get(`/api/v1/customers/${aliceCo.id}/events`).set('Cookie', cookie);
    expect(own.status).toBe(200);
    expect((own.body as ListBody<EventRow>).data.map((e) => e.title)).toEqual(['Alice review']);

    const foreign = await request(app).get(`/api/v1/customers/${bobCo.id}/events`).set('Cookie', cookie);
    expect((foreign.body as ListBody<EventRow>).data).toEqual([]);
    expect(JSON.stringify(foreign.body)).not.toContain('BobsSecretMeeting');
  });

  it('POST / creates a company owned by the caller', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Cookie', authFor(alice.id))
      .send({ name: 'Initech', domain: 'initech.example.com' });

    expect(res.status).toBe(201);
    const created = (res.body as ItemBody<CustomerRow>).data;
    const row = await prisma.customer.findUnique({ where: { id: created.id } });
    expect(row?.userId).toBe(alice.id);
  });

  it('PATCH /:id updates the caller\'s company and leaves another user\'s alone', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createCustomer(alice.id);
    const theirs = await createCustomer(bob.id, { name: 'BobsSecretCorp' });

    const cookie = authFor(alice.id);
    const ok = await request(app).patch(`/api/v1/customers/${mine.id}`).set('Cookie', cookie).send({ name: 'Renamed' });
    expect(ok.status).toBe(200);
    expect((ok.body as ItemBody<CustomerRow>).data.name).toBe('Renamed');

    const denied = await request(app)
      .patch(`/api/v1/customers/${theirs.id}`)
      .set('Cookie', cookie)
      .send({ name: 'Hijacked' });
    expect(denied.status).toBe(404);
    expect((await prisma.customer.findUnique({ where: { id: theirs.id } }))?.name).toBe('BobsSecretCorp');
  });

  it('PATCH /:id/vip toggles for the owner and refuses across users', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createCustomer(alice.id);
    const theirs = await createCustomer(bob.id);

    const cookie = authFor(alice.id);
    const ok = await request(app).patch(`/api/v1/customers/${mine.id}/vip`).set('Cookie', cookie).send({});
    expect(ok.status).toBe(200);
    expect((ok.body as ItemBody<CustomerRow>).data.isVip).toBe(true);

    const denied = await request(app).patch(`/api/v1/customers/${theirs.id}/vip`).set('Cookie', cookie).send({});
    expect(denied.status).toBe(404);
    expect((await prisma.customer.findUnique({ where: { id: theirs.id } }))?.isVip).toBe(false);
  });

  it('DELETE /:id removes the caller\'s company and refuses another user\'s', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createCustomer(alice.id);
    const theirs = await createCustomer(bob.id);

    const cookie = authFor(alice.id);
    expect((await request(app).delete(`/api/v1/customers/${mine.id}`).set('Cookie', cookie)).status).toBe(204);
    expect(await prisma.customer.findUnique({ where: { id: mine.id } })).toBeNull();

    const denied = await request(app).delete(`/api/v1/customers/${theirs.id}`).set('Cookie', cookie);
    expect(denied.status).toBe(404);
    expect(await prisma.customer.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

describe('/api/v1/deals', () => {
  it('GET / lists owned and shared deals with pagination meta', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createDeal(alice.id, { title: 'Alice deal' });
    const shared = await createDeal(bob.id, { title: 'Shared with Alice' });
    await shareDealWith(shared.id, bob.id, alice.id);
    await createDeal(bob.id, { title: 'BobsSecretDeal' });

    const res = await request(app).get('/api/v1/deals').set('Cookie', authFor(alice.id));
    expect(res.status).toBe(200);
    const body = res.body as ListBody<DealRow>;
    expect(ids(body.data)).toEqual(ids([mine, shared]));
    expect(body.meta).toMatchObject({ page: 1, limit: 20, total: 2 });
    expect(JSON.stringify(body)).not.toContain('BobsSecretDeal');
  });

  it('GET /?search= must not reach across users — REGRESSION', async () => {
    // The historical bug: `where.OR = [...search]` overwrote the ownership
    // filter, so a search returned every user's matching deals. Ownership now
    // lives under `AND`; this is the HTTP-level lock on that.
    //
    // Alice must hold at least one *shared* deal for this to bite. Only then
    // does `dealService` build the ownership filter as an `OR` — and only an
    // `OR` can be clobbered by the search branch. With no shares the filter is
    // a plain `{ userId }`, which survives the bug and hides it.
    const { alice, bob } = await createTwoUsers();
    const sharedIn = await createDeal(bob.id, { title: 'Zephyrine shared inbound' });
    await shareDealWith(sharedIn.id, bob.id, alice.id);
    const mine = await createDeal(alice.id, { title: 'Zephyrine renewal' });
    await createDeal(bob.id, { title: 'Zephyrine BobsSecretDeal' });

    const res = await request(app).get('/api/v1/deals?search=Zephyrine').set('Cookie', authFor(alice.id));
    const body = res.body as ListBody<DealRow>;
    expect(ids(body.data)).toEqual(ids([mine, sharedIn]));
    expect(body.meta.total).toBe(2);
    expect(JSON.stringify(body)).not.toContain('BobsSecretDeal');
  });

  it('GET /?status= filters, and page/limit paginate', async () => {
    const { alice } = await createTwoUsers();
    const partner = await createDealPartner(alice.id);
    await createDeal(alice.id, { partnerId: partner.id, title: 'A', status: 'APPROVED' });
    await createDeal(alice.id, { partnerId: partner.id, title: 'B', status: 'APPROVED' });
    await createDeal(alice.id, { partnerId: partner.id, title: 'C', status: 'DECLINED' });

    const cookie = authFor(alice.id);
    const filtered = await request(app).get('/api/v1/deals?status=APPROVED').set('Cookie', cookie);
    expect((filtered.body as ListBody<DealRow>).meta.total).toBe(2);

    const paged = await request(app).get('/api/v1/deals?status=APPROVED&page=2&limit=1').set('Cookie', cookie);
    const body = paged.body as ListBody<DealRow>;
    expect(body.data).toHaveLength(1);
    expect(body.meta).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2 });
  });

  it('GET /:id serves owner and share recipient, and 404s everyone else', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser();
    const deal = await createDeal(alice.id, { title: 'AlicesSecretDeal' });
    await shareDealWith(deal.id, alice.id, bob.id);

    const owner = await request(app).get(`/api/v1/deals/${deal.id}`).set('Cookie', authFor(alice.id));
    expect(owner.status).toBe(200);
    expect((owner.body as ItemBody<DealRow>).data.id).toBe(deal.id);

    const recipient = await request(app).get(`/api/v1/deals/${deal.id}`).set('Cookie', authFor(bob.id));
    expect(recipient.status).toBe(200);

    const stranger = await request(app).get(`/api/v1/deals/${deal.id}`).set('Cookie', authFor(carol.id));
    expect(stranger.status).toBe(404);
    expect(JSON.stringify(stranger.body)).not.toContain('AlicesSecretDeal');
  });

  it('POST / creates a deal owned by the caller', async () => {
    const { alice } = await createTwoUsers();
    const partner = await createDealPartner(alice.id, 'Alice Partner');

    const res = await request(app)
      .post('/api/v1/deals')
      .set('Cookie', authFor(alice.id))
      .send({ title: 'New deal', partnerId: partner.id });

    expect(res.status).toBe(201);
    const created = (res.body as ItemBody<DealRow>).data;
    expect(created.partner?.id).toBe(partner.id);
    expect((await prisma.deal.findUnique({ where: { id: created.id } }))?.userId).toBe(alice.id);
  });

  it('POST / refuses another user\'s partnerId and does not echo it back — REGRESSION', async () => {
    // Before the fix this returned 201 with `partner.name` set to Bob's partner
    // — a cross-tenant read for anyone holding a partner id, and a deal row
    // permanently pointing at another account.
    const { alice, bob } = await createTwoUsers();
    const bobPartner = await createDealPartner(bob.id, 'BobsSecretPartner');

    const res = await request(app)
      .post('/api/v1/deals')
      .set('Cookie', authFor(alice.id))
      .send({ title: 'Trojan', partnerId: bobPartner.id });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('BobsSecretPartner');
    expect(await prisma.deal.count({ where: { partnerId: bobPartner.id } })).toBe(0);
  });

  it('POST / refuses another user\'s customerId and does not echo it back — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    const partner = await createDealPartner(alice.id);
    const bobCo = await createCustomer(bob.id, { name: 'BobsSecretCorp' });

    const res = await request(app)
      .post('/api/v1/deals')
      .set('Cookie', authFor(alice.id))
      .send({ title: 'Trojan', partnerId: partner.id, customerId: bobCo.id });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('BobsSecretCorp');
    expect(await prisma.deal.count({ where: { customerId: bobCo.id } })).toBe(0);
  });

  it('PATCH /:id cannot repoint a deal at another account\'s company — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    const deal = await createDeal(alice.id);
    const bobCo = await createCustomer(bob.id, { name: 'BobsSecretCorp' });

    const res = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Cookie', authFor(alice.id))
      .send({ customerId: bobCo.id });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('BobsSecretCorp');
    expect((await prisma.deal.findUnique({ where: { id: deal.id } }))?.customerId).toBeNull();
  });

  it('PATCH /:id updates for the owner and refuses a stranger', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createDeal(alice.id);
    const theirs = await createDeal(bob.id, { title: 'BobsSecretDeal' });

    const cookie = authFor(alice.id);
    const ok = await request(app).patch(`/api/v1/deals/${mine.id}`).set('Cookie', cookie).send({ title: 'Renamed' });
    expect(ok.status).toBe(200);
    expect((ok.body as ItemBody<DealRow>).data.title).toBe('Renamed');

    const denied = await request(app).patch(`/api/v1/deals/${theirs.id}`).set('Cookie', cookie).send({ title: 'Hijacked' });
    expect(denied.status).toBe(404);
    expect((await prisma.deal.findUnique({ where: { id: theirs.id } }))?.title).toBe('BobsSecretDeal');
  });

  it('DELETE /:id is owner-only — a share recipient cannot destroy the deal', async () => {
    // `findById` deliberately serves shared deals; `delete` deliberately does
    // not. Sharing must not hand over the ability to delete.
    const { alice, bob } = await createTwoUsers();
    const deal = await createDeal(alice.id);
    await shareDealWith(deal.id, alice.id, bob.id);

    const recipient = await request(app).delete(`/api/v1/deals/${deal.id}`).set('Cookie', authFor(bob.id));
    expect(recipient.status).toBe(404);
    expect(await prisma.deal.findUnique({ where: { id: deal.id } })).not.toBeNull();

    const owner = await request(app).delete(`/api/v1/deals/${deal.id}`).set('Cookie', authFor(alice.id));
    expect(owner.status).toBe(204);
    expect(await prisma.deal.findUnique({ where: { id: deal.id } })).toBeNull();
  });

  it('POST /:id/share works for the owner and 404s for anyone else', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser();
    const deal = await createDeal(alice.id);

    const ok = await request(app)
      .post(`/api/v1/deals/${deal.id}/share`)
      .set('Cookie', authFor(alice.id))
      .send({ userIds: [bob.id] });
    expect(ok.status).toBe(200);
    expect((ok.body as ItemBody<{ sharedWith: number }>).data.sharedWith).toBe(1);

    const denied = await request(app)
      .post(`/api/v1/deals/${deal.id}/share`)
      .set('Cookie', authFor(bob.id))
      .send({ userIds: [carol.id] });
    expect(denied.status).toBe(404);
    expect(await prisma.dealShare.count({ where: { dealId: deal.id, sharedWithUserId: carol.id } })).toBe(0);
  });

  it('POST /:id/share rejects a body without userIds', async () => {
    const { alice } = await createTwoUsers();
    const deal = await createDeal(alice.id);
    const res = await request(app).post(`/api/v1/deals/${deal.id}/share`).set('Cookie', authFor(alice.id)).send({});
    expect(res.status).toBe(400);
  });

  it('GET /:id/shares is owner-only — a recipient cannot see who else it went to', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ email: 'carol-secret@example.com' });
    const deal = await createDeal(alice.id);
    await shareDealWith(deal.id, alice.id, bob.id);
    await shareDealWith(deal.id, alice.id, carol.id);

    const owner = await request(app).get(`/api/v1/deals/${deal.id}/shares`).set('Cookie', authFor(alice.id));
    expect(owner.status).toBe(200);
    expect((owner.body as ItemBody<ShareRow[]>).data).toHaveLength(2);

    const recipient = await request(app).get(`/api/v1/deals/${deal.id}/shares`).set('Cookie', authFor(bob.id));
    expect(recipient.status).toBe(404);
    expect(JSON.stringify(recipient.body)).not.toContain('carol-secret@example.com');
  });

  it('DELETE /:id/shares/:recipientId only revokes shares the caller granted', async () => {
    // `unshareDeal` answers 200 whether or not anything matched, so the status
    // proves nothing — the surviving row is the assertion. Without
    // `sharedByUserId: userId` any account could revoke anyone's shares.
    const { alice, bob } = await createTwoUsers();
    const deal = await createDeal(alice.id);
    await shareDealWith(deal.id, alice.id, bob.id);

    const byRecipient = await request(app)
      .delete(`/api/v1/deals/${deal.id}/shares/${bob.id}`)
      .set('Cookie', authFor(bob.id));
    expect(byRecipient.status).toBe(200);
    expect(await prisma.dealShare.count({ where: { dealId: deal.id } })).toBe(1);

    const byOwner = await request(app)
      .delete(`/api/v1/deals/${deal.id}/shares/${bob.id}`)
      .set('Cookie', authFor(alice.id));
    expect(byOwner.status).toBe(200);
    expect(await prisma.dealShare.count({ where: { dealId: deal.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

describe('/api/v1/tasks', () => {
  it('GET / lists owned, shared and assigned tasks and nothing else', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createTask(alice.id, { title: 'Alice task' });
    const shared = await createTask(bob.id, { title: 'Shared task' });
    await shareTaskWith(shared.id, bob.id, alice.id);
    const assigned = await createTask(bob.id, { title: 'Assigned task', assignedToId: alice.id });
    await createTask(bob.id, { title: 'BobsSecretTask' });

    const res = await request(app).get('/api/v1/tasks').set('Cookie', authFor(alice.id));
    expect(res.status).toBe(200);
    const body = res.body as ListBody<TaskRow>;
    expect(ids(body.data)).toEqual(ids([mine, shared, assigned]));
    expect(body.meta.total).toBe(3);
    expect(JSON.stringify(body)).not.toContain('BobsSecretTask');
  });

  it('GET /?search= keeps shared tasks and still never reaches across users', async () => {
    // Searching must narrow the access-controlled set, not replace it: a
    // shared task has to stay findable while another account's stays invisible.
    const { alice, bob } = await createTwoUsers();
    const mine = await createTask(alice.id, { title: 'Zephyrine migration' });
    const sharedIn = await createTask(bob.id, { title: 'Zephyrine shared inbound' });
    await shareTaskWith(sharedIn.id, bob.id, alice.id);
    await createTask(bob.id, { title: 'Zephyrine BobsSecretTask' });

    const res = await request(app).get('/api/v1/tasks?search=Zephyrine').set('Cookie', authFor(alice.id));
    const body = res.body as ListBody<TaskRow>;
    expect(ids(body.data)).toEqual(ids([mine, sharedIn]));
    expect(JSON.stringify(body)).not.toContain('BobsSecretTask');
  });

  it('GET / filters by status and paginates', async () => {
    const { alice } = await createTwoUsers();
    await createTask(alice.id, { status: 'TODO' });
    await createTask(alice.id, { status: 'TODO' });
    await createTask(alice.id, { status: 'DONE' });

    const cookie = authFor(alice.id);
    const filtered = await request(app).get('/api/v1/tasks?status=TODO').set('Cookie', cookie);
    expect((filtered.body as ListBody<TaskRow>).meta.total).toBe(2);

    const excluded = await request(app).get('/api/v1/tasks?statusNot=DONE').set('Cookie', cookie);
    expect((excluded.body as ListBody<TaskRow>).meta.total).toBe(2);

    const paged = await request(app).get('/api/v1/tasks?page=2&limit=2').set('Cookie', cookie);
    const body = paged.body as ListBody<TaskRow>;
    expect(body.data).toHaveLength(1);
    expect(body.meta).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it('GET /summary counts only what the caller can reach', async () => {
    const { alice, bob } = await createTwoUsers();
    // "Completed" is the isTerminal flag on a status row, not the name DONE,
    // so the account needs its statuses — as every real account has them.
    await seedTaskStatuses(alice.id);
    const day = 24 * 60 * 60 * 1000;
    // One genuinely overdue, one due later, one already DONE but past due —
    // "overdue" that counts finished work is just "past due date". Without a
    // dueDate anywhere, that whole branch ran unobserved and returning a
    // constant from it passed.
    await createTask(alice.id, { status: 'TODO', priority: 'HIGH', dueDate: new Date(Date.now() - day) });
    await createTask(alice.id, { status: 'TODO', dueDate: new Date(Date.now() + day) });
    await createTask(alice.id, { status: 'DONE', dueDate: new Date(Date.now() - day) });
    await createTask(bob.id, { status: 'TODO', dueDate: new Date(Date.now() - day) });
    await createTask(bob.id, { status: 'TODO' });

    const res = await request(app).get('/api/v1/tasks/summary').set('Cookie', authFor(alice.id));
    expect(res.status).toBe(200);
    const summary = (res.body as ItemBody<TaskSummary>).data;
    expect(summary.total).toBe(3);
    expect(summary.completed).toBe(1);
    expect(summary.overdue).toBe(1);
    expect(summary.byPriority.HIGH).toBe(1);
  });

  it('GET /:id serves owner, recipient and assignee, and 404s a stranger', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser();
    const task = await createTask(alice.id, { title: 'AlicesSecretTask' });
    await shareTaskWith(task.id, alice.id, bob.id);

    expect((await request(app).get(`/api/v1/tasks/${task.id}`).set('Cookie', authFor(alice.id))).status).toBe(200);
    expect((await request(app).get(`/api/v1/tasks/${task.id}`).set('Cookie', authFor(bob.id))).status).toBe(200);

    const stranger = await request(app).get(`/api/v1/tasks/${task.id}`).set('Cookie', authFor(carol.id));
    expect(stranger.status).toBe(404);
    expect(JSON.stringify(stranger.body)).not.toContain('AlicesSecretTask');
  });

  it('POST / creates a task owned by the caller', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app).post('/api/v1/tasks').set('Cookie', authFor(alice.id)).send({ title: 'Write tests' });

    expect(res.status).toBe(201);
    const created = (res.body as ItemBody<TaskRow>).data;
    expect(created.title).toBe('Write tests');
    expect((await prisma.task.findUnique({ where: { id: created.id } }))?.userId).toBe(alice.id);
  });

  it('POST / refuses another user\'s customerId and does not echo the company back — REGRESSION', async () => {
    // Before the fix this returned 201 and the response embedded Bob's whole
    // customer row — name, domain, notes — because `create` includes
    // `customer: true`.
    const { alice, bob } = await createTwoUsers();
    const bobCo = await createCustomer(bob.id, { name: 'BobsSecretCorp' });
    await prisma.customer.update({ where: { id: bobCo.id }, data: { notes: 'BobsSecretNotes' } });

    const res = await request(app)
      .post('/api/v1/tasks')
      .set('Cookie', authFor(alice.id))
      .send({ title: 'Trojan', customerId: bobCo.id });

    expect(res.status).toBe(404);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('BobsSecretCorp');
    expect(serialised).not.toContain('BobsSecretNotes');
    expect(await prisma.task.count({ where: { customerId: bobCo.id } })).toBe(0);
  });

  it('POST / refuses another user\'s labelId — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobLabel = await prisma.label.create({
      data: { userId: bob.id, name: 'BobsSecretLabel', color: '#ff0000' },
    });

    const res = await request(app)
      .post('/api/v1/tasks')
      .set('Cookie', authFor(alice.id))
      .send({ title: 'Trojan', labelIds: [bobLabel.id] });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('BobsSecretLabel');
    expect(await prisma.taskLabel.count({ where: { labelId: bobLabel.id } })).toBe(0);
  });

  it('PATCH /:id updates for the owner and refuses a stranger', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createTask(alice.id);
    const theirs = await createTask(bob.id, { title: 'BobsSecretTask' });

    const cookie = authFor(alice.id);
    const ok = await request(app).patch(`/api/v1/tasks/${mine.id}`).set('Cookie', cookie).send({ title: 'Renamed' });
    expect(ok.status).toBe(200);
    expect((ok.body as ItemBody<TaskRow>).data.title).toBe('Renamed');

    const denied = await request(app).patch(`/api/v1/tasks/${theirs.id}`).set('Cookie', cookie).send({ title: 'Hijacked' });
    expect(denied.status).toBe(404);
    expect((await prisma.task.findUnique({ where: { id: theirs.id } }))?.title).toBe('BobsSecretTask');
  });

  it('PATCH /reorder moves the caller\'s own cards', async () => {
    const { alice } = await createTwoUsers();
    const one = await createTask(alice.id, { status: 'TODO' });
    const two = await createTask(alice.id, { status: 'TODO' });

    const res = await request(app)
      .patch('/api/v1/tasks/reorder')
      .set('Cookie', authFor(alice.id))
      .send({
        items: [
          { id: one.id, status: 'IN_PROGRESS', position: 2000 },
          { id: two.id, status: 'TODO', position: 1000 },
        ],
      });

    expect(res.status).toBe(200);
    expect((res.body as ItemBody<{ success: boolean }>).data.success).toBe(true);
    const moved = await prisma.task.findUnique({ where: { id: one.id } });
    expect(moved).toMatchObject({ status: 'IN_PROGRESS', position: 2000 });
  });

  it('PATCH /reorder rejects a batch containing another user\'s task and moves nothing', async () => {
    // The whole batch is one transaction. A foreign id must not merely be
    // skipped — it has to abort the write, so the caller's own cards do not
    // half-move. It also has to be a 404: before the fix the unowned `update`
    // raised P2025 and the client got a 500.
    const { alice, bob } = await createTwoUsers();
    const bobsOwn = await createTask(bob.id, { status: 'TODO' });
    const alices = await createTask(alice.id, { status: 'TODO' });

    const res = await request(app)
      .patch('/api/v1/tasks/reorder')
      .set('Cookie', authFor(bob.id))
      .send({
        items: [
          { id: bobsOwn.id, status: 'DONE', position: 500 },
          { id: alices.id, status: 'DONE', position: 900 },
        ],
      });

    expect(res.status).toBe(404);
    expect(await prisma.task.findUnique({ where: { id: alices.id } })).toMatchObject({ status: 'TODO', position: 0 });
    expect(await prisma.task.findUnique({ where: { id: bobsOwn.id } })).toMatchObject({ status: 'TODO', position: 0 });
  });

  it('DELETE /:id is owner-only — a share recipient cannot destroy the task', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(alice.id);
    await shareTaskWith(task.id, alice.id, bob.id);

    const recipient = await request(app).delete(`/api/v1/tasks/${task.id}`).set('Cookie', authFor(bob.id));
    expect(recipient.status).toBe(404);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();

    const owner = await request(app).delete(`/api/v1/tasks/${task.id}`).set('Cookie', authFor(alice.id));
    expect(owner.status).toBe(204);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
  });

  it('POST /:id/share works for the owner and 404s for anyone else', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser();
    const task = await createTask(alice.id);

    const ok = await request(app)
      .post(`/api/v1/tasks/${task.id}/share`)
      .set('Cookie', authFor(alice.id))
      .send({ userIds: [bob.id] });
    expect(ok.status).toBe(200);
    expect((ok.body as ItemBody<{ sharedWith: number }>).data.sharedWith).toBe(1);

    const denied = await request(app)
      .post(`/api/v1/tasks/${task.id}/share`)
      .set('Cookie', authFor(bob.id))
      .send({ userIds: [carol.id] });
    expect(denied.status).toBe(404);
    expect(await prisma.taskShare.count({ where: { taskId: task.id, sharedWithUserId: carol.id } })).toBe(0);
  });

  it('GET /:id/shares is owner-only — a recipient cannot see who else it went to', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ email: 'carol-secret-task@example.com' });
    const task = await createTask(alice.id);
    await shareTaskWith(task.id, alice.id, bob.id);
    await shareTaskWith(task.id, alice.id, carol.id);

    const owner = await request(app).get(`/api/v1/tasks/${task.id}/shares`).set('Cookie', authFor(alice.id));
    expect(owner.status).toBe(200);
    expect((owner.body as ItemBody<ShareRow[]>).data).toHaveLength(2);

    const recipient = await request(app).get(`/api/v1/tasks/${task.id}/shares`).set('Cookie', authFor(bob.id));
    expect(recipient.status).toBe(404);
    expect(JSON.stringify(recipient.body)).not.toContain('carol-secret-task@example.com');
  });

  it('DELETE /:id/shares/:recipientId only revokes shares the caller granted', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(alice.id);
    await shareTaskWith(task.id, alice.id, bob.id);

    const byRecipient = await request(app)
      .delete(`/api/v1/tasks/${task.id}/shares/${bob.id}`)
      .set('Cookie', authFor(bob.id));
    expect(byRecipient.status).toBe(200);
    expect(await prisma.taskShare.count({ where: { taskId: task.id } })).toBe(1);

    const byOwner = await request(app)
      .delete(`/api/v1/tasks/${task.id}/shares/${bob.id}`)
      .set('Cookie', authFor(alice.id));
    expect(byOwner.status).toBe(200);
    expect(await prisma.taskShare.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('PATCH /:id cannot be used to reassign a shared task — REGRESSION', async () => {
    // Both doors to the same escalation. /assign was tightened first; this is
    // the ordinary edit route, which also accepts assignedToId and was still
    // gating on canAccessTask. Exercised over HTTP because that is the surface
    // an attacker actually has.
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser();
    const task = await createTask(alice.id);
    await shareTaskWith(task.id, alice.id, bob.id);

    const res = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Cookie', authFor(bob.id))
      .send({ assignedToId: carol.id });

    expect(res.status).toBe(404);
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assignedToId
    ).toBeNull();
  });

  it('PATCH /:id still lets a share recipient edit the task', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(alice.id, { title: 'before' });
    await shareTaskWith(task.id, alice.id, bob.id);

    const res = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Cookie', authFor(bob.id))
      .send({ title: 'after' });

    expect(res.status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).title).toBe('after');
  });

  it('PATCH /:id/assign works on reachable tasks and 404s on a stranger\'s', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser();
    const mine = await createTask(alice.id);
    const theirs = await createTask(carol.id, { title: 'CarolsSecretTask' });

    const cookie = authFor(alice.id);
    const ok = await request(app).patch(`/api/v1/tasks/${mine.id}/assign`).set('Cookie', cookie).send({ assignedToId: bob.id });
    expect(ok.status).toBe(200);
    expect((ok.body as ItemBody<TaskRow>).data.assignedToId).toBe(bob.id);

    const denied = await request(app)
      .patch(`/api/v1/tasks/${theirs.id}/assign`)
      .set('Cookie', cookie)
      .send({ assignedToId: alice.id });
    expect(denied.status).toBe(404);
    // The dangerous failure is not the status but the write: assigning
    // yourself another account's task would grant you access to it forever.
    expect((await prisma.task.findUnique({ where: { id: theirs.id } }))?.assignedToId).toBeNull();
    expect(JSON.stringify(denied.body)).not.toContain('CarolsSecretTask');
  });

  it('answers 404 rather than crashing on an id that is not a uuid', async () => {
    const { alice } = await createTwoUsers();
    const res = await request(app).get('/api/v1/tasks/not-a-uuid').set('Cookie', authFor(alice.id));
    expect(res.status).toBe(404);
  });
});

describe('/api/v1/tasks — subtasks and checklist', () => {
  it('POST / with a parentId owned by another account is a 404, and creates nothing', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobs = await createTask(bob.id, { title: 'BobsSecretTask' });

    const res = await request(app)
      .post('/api/v1/tasks')
      .set('Cookie', authFor(alice.id))
      .send({ title: 'Sneaky', parentId: bobs.id });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('BobsSecretTask');
    expect(await prisma.task.count({ where: { parentId: bobs.id } })).toBe(0);
  });

  it('GET /:id returns the subtasks and checklist, and list rows carry the counts', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const cookie = authFor(alice.id);
    const parent = await createTask(alice.id, { title: 'Parent' });
    await createTask(alice.id, { parentId: parent.id, status: 'DONE' });
    await createTask(alice.id, { parentId: parent.id, status: 'TODO' });

    const added = await request(app)
      .post(`/api/v1/tasks/${parent.id}/checklist`)
      .set('Cookie', cookie)
      .send({ text: '  Call Sam  ' });
    expect(added.status).toBe(201);
    expect(added.body.data.text).toBe('Call Sam');

    const detail = await request(app).get(`/api/v1/tasks/${parent.id}`).set('Cookie', cookie);
    expect(detail.body.data).toMatchObject({ subtaskCount: 2, subtaskDoneCount: 1, checklistCount: 1, checklistDoneCount: 0 });
    expect(detail.body.data.subtasks).toHaveLength(2);
    expect(detail.body.data.checklist).toHaveLength(1);

    const list = await request(app).get('/api/v1/tasks?topLevel=true').set('Cookie', cookie);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id: parent.id, subtaskCount: 2, subtaskDoneCount: 1, checklistCount: 1 });
    expect(list.body.data[0]).not.toHaveProperty('checklist');
  });

  it('checklist writes validate, and an item on another account\'s task is a 404', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createTask(alice.id);
    const bobs = await createTask(bob.id);
    const bobsItem = await prisma.taskChecklistItem.create({ data: { taskId: bobs.id, text: 'BobsSecretStep' } });

    const blank = await request(app)
      .post(`/api/v1/tasks/${mine.id}/checklist`)
      .set('Cookie', authFor(alice.id))
      .send({ text: '   ' });
    expect(blank.status).toBe(400);

    const empty = await request(app)
      .patch(`/api/v1/tasks/${mine.id}/checklist/${bobsItem.id}`)
      .set('Cookie', authFor(alice.id))
      .send({});
    expect(empty.status).toBe(400);

    const cross = await request(app)
      .patch(`/api/v1/tasks/${mine.id}/checklist/${bobsItem.id}`)
      .set('Cookie', authFor(alice.id))
      .send({ isDone: true });
    expect(cross.status).toBe(404);
    expect(JSON.stringify(cross.body)).not.toContain('BobsSecretStep');

    const gone = await request(app)
      .delete(`/api/v1/tasks/${bobs.id}/checklist/${bobsItem.id}`)
      .set('Cookie', authFor(alice.id));
    expect(gone.status).toBe(404);
    expect((await prisma.taskChecklistItem.findUniqueOrThrow({ where: { id: bobsItem.id } })).isDone).toBe(false);
  });
});

describe('/api/v1/tasks — activity and comments', () => {
  it('a comment round-trips, appears in the activity, and validates its body', async () => {
    const { alice } = await createTwoUsers();
    const cookie = authFor(alice.id);
    const task = await createTask(alice.id, { title: 'Discuss' });

    const blank = await request(app).post(`/api/v1/tasks/${task.id}/comments`).set('Cookie', cookie).send({ body: '   ' });
    expect(blank.status).toBe(400);

    const posted = await request(app)
      .post(`/api/v1/tasks/${task.id}/comments`)
      .set('Cookie', cookie)
      .send({ body: '  First thought  ' });
    expect(posted.status).toBe(201);
    expect(posted.body.data).toMatchObject({ body: 'First thought', mentions: [], user: { id: alice.id } });

    const activity = await request(app).get(`/api/v1/tasks/${task.id}/activity`).set('Cookie', cookie);
    expect(activity.status).toBe(200);
    expect(activity.body.data[0]).toMatchObject({ kind: 'comment', body: 'First thought', actor: { id: alice.id } });
  });

  it('a stranger gets a 404 on the activity, and cannot reach a comment through their own task', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobs = await createTask(bob.id);
    const mine = await createTask(alice.id);
    const comment = await prisma.taskComment.create({ data: { taskId: bobs.id, userId: bob.id, body: 'BobsSecretComment' } });

    const activity = await request(app).get(`/api/v1/tasks/${bobs.id}/activity`).set('Cookie', authFor(alice.id));
    expect(activity.status).toBe(404);

    const cross = await request(app)
      .patch(`/api/v1/tasks/${mine.id}/comments/${comment.id}`)
      .set('Cookie', authFor(alice.id))
      .send({ body: 'hijacked' });
    expect(cross.status).toBe(404);
    expect(JSON.stringify(cross.body)).not.toContain('BobsSecretComment');
    expect((await prisma.taskComment.findUniqueOrThrow({ where: { id: comment.id } })).body).toBe('BobsSecretComment');
  });
});

describe('/api/v1/tasks — dependencies', () => {
  it('finishing a blocked task is a 409 that names the blockers; force gets past it', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const cookie = authFor(alice.id);
    const design = await createTask(alice.id, { title: 'Design' });
    const build = await createTask(alice.id, { title: 'Build' });

    const added = await request(app).post(`/api/v1/tasks/${build.id}/dependencies`).set('Cookie', cookie).send({ blockerId: design.id });
    expect(added.status).toBe(201);
    expect(added.body.data.blockedBy).toEqual([{ id: design.id, title: 'Design', status: 'TODO' }]);

    const refused = await request(app).patch(`/api/v1/tasks/${build.id}`).set('Cookie', cookie).send({ status: 'DONE' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'TASK_BLOCKED', details: { blockers: [{ id: design.id, title: 'Design' }] } });
    expect(refused.body.error.message).toContain('Design');

    const forced = await request(app).patch(`/api/v1/tasks/${build.id}`).set('Cookie', cookie).send({ status: 'DONE', force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.data.status).toBe('DONE');
  });

  it('another account\'s task cannot be named as a blocker', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createTask(alice.id);
    const bobs = await createTask(bob.id, { title: 'BobsSecretTask' });

    const res = await request(app).post(`/api/v1/tasks/${mine.id}/dependencies`).set('Cookie', authFor(alice.id)).send({ blockerId: bobs.id });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('BobsSecretTask');
    expect(await prisma.taskDependency.count()).toBe(0);
  });
});

describe('/api/v1/tasks — links', () => {
  it('links a deal, validates the type, and refuses another account\'s record', async () => {
    const { alice, bob } = await createTwoUsers();
    const cookie = authFor(alice.id);
    const task = await createTask(alice.id);
    const deal = await createDeal(alice.id, { title: 'Acme renewal' });
    const bobsDeal = await createDeal(bob.id, { title: 'BobsSecretDeal' });

    const bad = await request(app).post(`/api/v1/tasks/${task.id}/links`).set('Cookie', cookie).send({ entityType: 'customer', entityId: deal.id });
    expect(bad.status).toBe(400);

    const cross = await request(app).post(`/api/v1/tasks/${task.id}/links`).set('Cookie', cookie).send({ entityType: 'deal', entityId: bobsDeal.id });
    expect(cross.status).toBe(404);
    expect(JSON.stringify(cross.body)).not.toContain('BobsSecretDeal');

    const ok = await request(app).post(`/api/v1/tasks/${task.id}/links`).set('Cookie', cookie).send({ entityType: 'deal', entityId: deal.id });
    expect(ok.status).toBe(201);
    expect(ok.body.data.links).toEqual([{ entityType: 'deal', entityId: deal.id, label: 'Acme renewal', subtitle: expect.any(String), when: null }]);

    const reverse = await request(app).get(`/api/v1/tasks?linkedTo=deal:${deal.id}`).set('Cookie', cookie);
    expect(reverse.body.data.map((t: { id: string }) => t.id)).toEqual([task.id]);

    const gone = await request(app).delete(`/api/v1/tasks/${task.id}/links/deal/${deal.id}`).set('Cookie', cookie);
    expect(gone.status).toBe(200);
    expect(gone.body.data.links).toEqual([]);
  });
});

describe('/api/v1/tasks — time', () => {
  it('starts and stops a timer, logs by hand with validation, and reports the running one', async () => {
    const { alice } = await createTwoUsers();
    const cookie = authFor(alice.id);
    const task = await createTask(alice.id, { title: 'Brief' });

    const none = await request(app).get('/api/v1/tasks/time/running').set('Cookie', cookie);
    expect(none.status).toBe(200);
    expect(none.body.data).toBeNull();

    const started = await request(app).post(`/api/v1/tasks/${task.id}/time/start`).set('Cookie', cookie);
    expect(started.status).toBe(201);
    const running = await request(app).get('/api/v1/tasks/time/running').set('Cookie', cookie);
    expect(running.body.data).toMatchObject({ taskId: task.id, task: { title: 'Brief' } });

    const stopped = await request(app).post(`/api/v1/tasks/${task.id}/time/stop`).set('Cookie', cookie);
    expect(stopped.status).toBe(200);
    expect(stopped.body.data.minutes).toBeGreaterThanOrEqual(1);

    const bad = await request(app).post(`/api/v1/tasks/${task.id}/time`).set('Cookie', cookie).send({ minutes: 0 });
    expect(bad.status).toBe(400);
    const logged = await request(app).post(`/api/v1/tasks/${task.id}/time`).set('Cookie', cookie).send({ minutes: 30, note: 'Call' });
    expect(logged.status).toBe(201);

    const detail = await request(app).get(`/api/v1/tasks/${task.id}`).set('Cookie', cookie);
    expect(detail.body.data.trackedMinutes).toBe(stopped.body.data.minutes + 30);
    expect(detail.body.data.timeEntries).toHaveLength(2);
  });
});
