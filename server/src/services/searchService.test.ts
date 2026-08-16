import { describe, it, expect } from 'vitest';
import { searchService } from './searchService.js';
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
