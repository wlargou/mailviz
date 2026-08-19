import { describe, it, expect } from 'vitest';
import { searchService } from './searchService.js';
import { prisma } from '../lib/prisma.js';
import {
  createTwoUsers,
  createCustomer,
  createContact,
  createTask,
  createDeal,
  createEmail,
  shareTaskWith,
  shareDealWith,
  shareThreadWith,
} from '../test/factories.js';

/**
 * Local fixture — calendar events are not in the shared factories, and search
 * is the only place that reads them without going through the sync path.
 */
async function seedEvent(
  userId: string,
  overrides: Partial<{ title: string; description: string; startTime: Date }> = {}
) {
  const startTime = overrides.startTime ?? new Date();
  return prisma.calendarEvent.create({
    data: {
      userId,
      title: overrides.title ?? 'Event',
      startTime,
      endTime: new Date(startTime.getTime() + 3_600_000),
      ...(overrides.description !== undefined ? { description: overrides.description } : {}),
    },
  });
}

/**
 * Global search fans out across six tables in one call.
 *
 * That makes it the highest-consequence place in the app for a missing
 * ownership constraint: one bad branch leaks a different entity type than the
 * one being audited, and the endpoint returns a little of everything, so the
 * leak is easy to miss when reading any single query. `dealService.findAll`
 * showed how a search branch can quietly drop ownership — this pins down that
 * every branch here keeps it.
 *
 * Note that global search deliberately shows *owned* rows only: shares do not
 * widen it. That is asserted too, so a future "include shared results" change
 * has to be a deliberate one rather than a side effect.
 */
describe('searchService.search — tenant isolation', () => {
  it('returns nothing belonging to another user across every entity type', async () => {
    const { alice, bob } = await createTwoUsers();

    const bobCustomer = await createCustomer(bob.id, { name: 'Zebra Corp' });
    await createContact(bobCustomer.id, { firstName: 'Zebra', lastName: 'Person' });
    await createTask(bob.id, { title: 'Zebra task' });
    await createDeal(bob.id, { title: 'Zebra deal' });
    await createEmail(bob.id, { subject: 'Zebra mail' });

    const results = await searchService.search('zebra', alice.id);

    expect(results.emails).toEqual([]);
    expect(results.tasks).toEqual([]);
    expect(results.events).toEqual([]);
    expect(results.customers).toEqual([]);
    expect(results.contacts).toEqual([]);
    expect(results.deals).toEqual([]);
  });

  it('returns the caller’s own matches', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { name: 'Zebra Corp' });
    await createContact(customer.id, { firstName: 'Zebra', lastName: 'Person' });
    await createTask(alice.id, { title: 'Zebra task' });
    await createDeal(alice.id, { title: 'Zebra deal' });
    await createEmail(alice.id, { subject: 'Zebra mail' });

    const results = await searchService.search('zebra', alice.id);

    expect(results.customers.map((c) => c.name)).toEqual(['Zebra Corp']);
    expect(results.contacts.map((c) => c.firstName)).toEqual(['Zebra']);
    expect(results.tasks.map((t) => t.title)).toEqual(['Zebra task']);
    expect(results.deals.map((d) => d.title)).toEqual(['Zebra deal']);
    expect(results.emails.map((e) => e.subject)).toEqual(['Zebra mail']);
  });

  it('does not surface shared rows — global search is owned-only by design', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(bob.id, { title: 'Zebra task' });
    await shareTaskWith(task.id, bob.id, alice.id);
    const deal = await createDeal(bob.id, { title: 'Zebra deal' });
    await shareDealWith(deal.id, bob.id, alice.id);
    await createEmail(bob.id, { threadId: 'thread-shared', subject: 'Zebra mail' });
    await shareThreadWith('thread-shared', bob.id, alice.id);

    const results = await searchService.search('zebra', alice.id);

    expect(results.tasks).toEqual([]);
    expect(results.deals).toEqual([]);
    expect(results.emails).toEqual([]);
  });

  it('treats a search containing SQL syntax as a literal', async () => {
    const { alice } = await createTwoUsers();
    await createTask(alice.id, { title: 'Survivor task' });

    const results = await searchService.search("'; DROP TABLE tasks; --", alice.id);

    expect(results.tasks).toEqual([]);
    expect((await searchService.search('survivor', alice.id)).tasks.map((t) => t.title)).toEqual([
      'Survivor task',
    ]);
  });
});

/**
 * The isolation test above gives the caller nothing of their own, so a leak
 * shows up as "expected [] to be non-empty". These give *both* users matching
 * rows, which is the realistic shape: a leak then hides among genuine results,
 * and — because each entity type is capped at four — another user's rows can
 * push the caller's own results off the end.
 */
describe('searchService.search — tenant isolation with both users matching', () => {
  it('returns the caller’s row and only theirs, for every entity type — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();

    for (const user of [alice, bob]) {
      const who = user.id === alice.id ? 'alice' : 'bob';
      const customer = await prisma.customer.create({
        data: { userId: user.id, name: `Kestrel ${who}`, domain: `kestrel-${who}.example` },
      });
      await createContact(customer.id, { firstName: 'Kestrel', lastName: who });
      await prisma.task.create({ data: { userId: user.id, title: `Kestrel task ${who}` } });
      await createDeal(user.id, { title: `Kestrel deal ${who}` });
      await createEmail(user.id, { subject: `Kestrel mail ${who}` });
      await seedEvent(user.id, { title: `Kestrel event ${who}` });
    }

    const results = await searchService.search('kestrel', alice.id);

    expect(results.customers.map((c) => c.name)).toEqual(['Kestrel alice']);
    expect(results.contacts.map((c) => c.lastName)).toEqual(['alice']);
    expect(results.tasks.map((t) => t.title)).toEqual(['Kestrel task alice']);
    expect(results.deals.map((d) => d.title)).toEqual(['Kestrel deal alice']);
    expect(results.emails.map((e) => e.subject)).toEqual(['Kestrel mail alice']);
    expect(results.events.map((e) => e.title)).toEqual(['Kestrel event alice']);
  });
});

describe('searchService.search — query handling', () => {
  /**
   * A one-character query would match a large fraction of every table across
   * six queries at once. The guard is what stops the search box firing that on
   * the first keystroke.
   */
  it('returns nothing for a query shorter than two characters', async () => {
    const { alice } = await createTwoUsers();
    await createTask(alice.id, { title: 'a' });
    await createTask(alice.id, { title: 'zebra' });

    for (const query of ['', ' ', 'a', '  z  ']) {
      const results = await searchService.search(query, alice.id);
      expect(results).toEqual({ emails: [], tasks: [], events: [], customers: [], contacts: [], deals: [] });
    }
  });

  it('trims surrounding whitespace before matching', async () => {
    const { alice } = await createTwoUsers();
    await createTask(alice.id, { title: 'Zebra task' });

    expect((await searchService.search('   zebra   ', alice.id)).tasks.map((t) => t.title)).toEqual(['Zebra task']);
  });

  it('matches at exactly two characters', async () => {
    const { alice } = await createTwoUsers();
    await createTask(alice.id, { title: 'QQ report' });

    expect((await searchService.search('qq', alice.id)).tasks).toHaveLength(1);
  });

  /** Users type lowercase; the data is not. */
  it('is case-insensitive in every entity type', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { name: 'Zebra Corp' });
    await createContact(customer.id, { firstName: 'Zebra', lastName: 'Person' });
    await createTask(alice.id, { title: 'Zebra task' });
    await createDeal(alice.id, { title: 'Zebra deal' });
    await createEmail(alice.id, { subject: 'Zebra mail' });
    await seedEvent(alice.id, { title: 'Zebra event' });

    const results = await searchService.search('ZEBRA', alice.id);

    expect(results.customers).toHaveLength(1);
    expect(results.contacts).toHaveLength(1);
    expect(results.tasks).toHaveLength(1);
    expect(results.deals).toHaveLength(1);
    expect(results.emails).toHaveLength(1);
    expect(results.events).toHaveLength(1);
  });
});

/**
 * Each entity searches several columns. A dropped branch is invisible from the
 * outside — the search simply finds less — so each one is pinned by a row that
 * matches on that column *alone*.
 */
describe('searchService.search — the columns each entity matches on', () => {
  it('matches mail on sender address, sender name and snippet, not just subject', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { subject: 'unrelated one', from: 'kestrel@vendor.example' });
    await createEmail(alice.id, { subject: 'unrelated two', snippet: 'about the kestrel migration' });
    await prisma.email.create({
      data: {
        userId: alice.id,
        gmailMessageId: 'gm-fromname',
        threadId: 'thread-fromname',
        subject: 'unrelated three',
        from: 'someone@vendor.example',
        fromName: 'Kestrel Support',
        receivedAt: new Date(),
      },
    });

    const subjects = (await searchService.search('kestrel', alice.id)).emails.map((e) => e.subject);

    expect(subjects.sort()).toEqual(['unrelated one', 'unrelated three', 'unrelated two']);
  });

  it('matches tasks on description', async () => {
    const { alice } = await createTwoUsers();
    await prisma.task.create({
      data: { userId: alice.id, title: 'Weekly review', description: 'chase the kestrel renewal' },
    });

    expect((await searchService.search('kestrel', alice.id)).tasks.map((t) => t.title)).toEqual(['Weekly review']);
  });

  it('matches events on title and description', async () => {
    const { alice } = await createTwoUsers();
    await seedEvent(alice.id, { title: 'Kestrel kickoff' });
    await seedEvent(alice.id, { title: 'Ordinary meeting', description: 'kestrel agenda' });
    await seedEvent(alice.id, { title: 'Nothing to do with it' });

    const titles = (await searchService.search('kestrel', alice.id)).events.map((e) => e.title);

    expect(titles.sort()).toEqual(['Kestrel kickoff', 'Ordinary meeting']);
  });

  it('matches customers on company and email as well as name', async () => {
    const { alice } = await createTwoUsers();
    await prisma.customer.create({
      data: { userId: alice.id, name: 'Alpha', company: 'Kestrel Holdings', domain: 'alpha.example' },
    });
    await prisma.customer.create({
      data: { userId: alice.id, name: 'Beta', email: 'hello@kestrel.example', domain: 'beta.example' },
    });
    await prisma.customer.create({ data: { userId: alice.id, name: 'Gamma', domain: 'gamma.example' } });

    expect((await searchService.search('kestrel', alice.id)).customers.map((c) => c.name)).toEqual(['Alpha', 'Beta']);
  });

  it('matches contacts on last name and email as well as first name', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { name: 'Holder' });
    await createContact(customer.id, { firstName: 'Ada', lastName: 'Kestrel' });
    await createContact(customer.id, { firstName: 'Bo', lastName: 'Smith', email: 'bo@kestrel.example' });
    await createContact(customer.id, { firstName: 'Cy', lastName: 'Jones', email: 'cy@other.example' });

    const found = (await searchService.search('kestrel', alice.id)).contacts.map((c) => c.firstName);

    expect(found).toEqual(['Ada', 'Bo']);
  });

  it('matches deals on products and notes as well as title', async () => {
    const { alice } = await createTwoUsers();
    await createDeal(alice.id, { title: 'Deal one', products: 'Kestrel Enterprise' });
    await prisma.deal.create({
      data: {
        userId: alice.id,
        partnerId: (await createDeal(alice.id, { title: 'holder' })).partnerId,
        title: 'Deal two',
        notes: 'renewal blocked on kestrel pricing',
      },
    });

    const titles = (await searchService.search('kestrel', alice.id)).deals.map((d) => d.title);

    expect(titles.sort()).toEqual(['Deal one', 'Deal two']);
  });

  it('returns the contact’s customer name so a result can be labelled', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { name: 'Kestrel Corp' });
    await createContact(customer.id, { firstName: 'Kestrel', lastName: 'Person' });

    const [contact] = (await searchService.search('kestrel', alice.id)).contacts;

    expect(contact.customerId).toBe(customer.id);
    expect(contact.customer).toEqual({ name: 'Kestrel Corp' });
  });
});

describe('searchService.search — result shaping', () => {
  /**
   * Global search is a type-ahead panel, not a results page: four rows per
   * type. Losing the cap turns one keystroke into six unbounded table scans
   * serialised into a single response.
   */
  it('caps every entity type at four results', async () => {
    const { alice } = await createTwoUsers();
    for (let i = 0; i < 6; i++) {
      await createTask(alice.id, { title: `Kestrel task ${i}` });
      await createDeal(alice.id, { title: `Kestrel deal ${i}` });
      await createEmail(alice.id, { threadId: `kestrel-thread-${i}`, subject: `Kestrel mail ${i}` });
      await seedEvent(alice.id, { title: `Kestrel event ${i}` });
      await prisma.customer.create({
        data: { userId: alice.id, name: `Kestrel customer ${i}`, domain: `kestrel-${i}.example` },
      });
    }
    const customer = await createCustomer(alice.id, { name: 'Holder' });
    for (let i = 0; i < 6; i++) {
      await createContact(customer.id, { firstName: 'Kestrel', lastName: `Person ${i}` });
    }

    const results = await searchService.search('kestrel', alice.id);

    expect(results.tasks).toHaveLength(4);
    expect(results.deals).toHaveLength(4);
    expect(results.emails).toHaveLength(4);
    expect(results.events).toHaveLength(4);
    expect(results.customers).toHaveLength(4);
    expect(results.contacts).toHaveLength(4);
  });

  /** A deleted mail reappearing in search is the bug users report as "it's back". */
  it('excludes trashed mail', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { subject: 'Kestrel kept', isTrashed: false });
    await createEmail(alice.id, { subject: 'Kestrel deleted', isTrashed: true });

    expect((await searchService.search('kestrel', alice.id)).emails.map((e) => e.subject)).toEqual(['Kestrel kept']);
  });

  /** One noisy thread must not consume the whole four-row mail budget. */
  it('returns one row per mail thread', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 'chatty', subject: 'Kestrel first', receivedAt: new Date(Date.now() - 30_000) });
    await createEmail(alice.id, { threadId: 'chatty', subject: 'Kestrel reply', receivedAt: new Date() });
    await createEmail(alice.id, { threadId: 'quiet', subject: 'Kestrel other', receivedAt: new Date(Date.now() - 60_000) });

    const emails = (await searchService.search('kestrel', alice.id)).emails;
    const threadIds = emails.map((e) => e.threadId);

    expect(new Set(threadIds).size).toBe(threadIds.length);
    expect(threadIds).toEqual(['chatty', 'quiet']);
    // Newest message in the thread represents it.
    expect(emails[0].subject).toBe('Kestrel reply');
  });

  it('orders mail newest first and customers alphabetically', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 'a', subject: 'Kestrel old', receivedAt: new Date(Date.now() - 120_000) });
    await createEmail(alice.id, { threadId: 'b', subject: 'Kestrel new', receivedAt: new Date() });
    await prisma.customer.create({ data: { userId: alice.id, name: 'Kestrel Zulu', domain: 'z.example' } });
    await prisma.customer.create({ data: { userId: alice.id, name: 'Kestrel Alpha', domain: 'a.example' } });

    const results = await searchService.search('kestrel', alice.id);

    expect(results.emails.map((e) => e.subject)).toEqual(['Kestrel new', 'Kestrel old']);
    expect(results.customers.map((c) => c.name)).toEqual(['Kestrel Alpha', 'Kestrel Zulu']);
  });
});
