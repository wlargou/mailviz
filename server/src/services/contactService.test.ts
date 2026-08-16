import { describe, it, expect } from 'vitest';
import { contactService } from './contactService.js';
import { createTwoUsers, createCustomer, createContact, createEmail } from '../test/factories.js';

/**
 * Multi-tenant isolation for contacts.
 *
 * Contacts have no `userId` of their own — they are reachable only through
 * `customer.userId`, so every query has to join through the customer. That
 * makes the ownership constraint easy to drop by accident.
 *
 * `findAll` is really two implementations. The default sort (`emailCount`)
 * can't be expressed in Prisma's orderBy, so it runs hand-written SQL; every
 * other sort goes through the ordinary Prisma path. Both are tested here,
 * because covering only one would leave half the endpoint unguarded — and the
 * default is the raw one, which is what users actually hit.
 *
 * The raw path used to be `$queryRawUnsafe` with the userId interpolated
 * straight into the string. It is now `Prisma.sql` with bound parameters, so
 * the tests below also push a single quote and a statement terminator through
 * `search` to prove values are bound, not concatenated.
 */
describe('contactService.findAll — tenant isolation', () => {
  it('returns only contacts belonging to the caller’s customers (raw emailCount sort)', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCustomer = await createCustomer(alice.id);
    const bobCustomer = await createCustomer(bob.id);
    await createContact(aliceCustomer.id, { lastName: 'AliceContact' });
    await createContact(bobCustomer.id, { lastName: 'BobContact' });

    const result = await contactService.findAll(alice.id, {});

    expect(result.data).toHaveLength(1);
    expect(result.data[0].lastName).toBe('AliceContact');
    expect(result.meta.total).toBe(1);
  });

  it('returns only contacts belonging to the caller’s customers (Prisma sort path)', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCustomer = await createCustomer(alice.id);
    const bobCustomer = await createCustomer(bob.id);
    await createContact(aliceCustomer.id, { lastName: 'AliceContact' });
    await createContact(bobCustomer.id, { lastName: 'BobContact' });

    const result = await contactService.findAll(alice.id, { sortBy: 'lastName', sortOrder: 'asc' });

    expect(result.data.map((c) => c.lastName)).toEqual(['AliceContact']);
    expect(result.meta.total).toBe(1);
  });

  it('does not leak other users’ contacts when searching, on either sort path', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCustomer = await createCustomer(alice.id);
    const bobCustomer = await createCustomer(bob.id);
    await createContact(aliceCustomer.id, { firstName: 'Dana', lastName: 'Widget' });
    await createContact(bobCustomer.id, { firstName: 'Erik', lastName: 'Widget' });

    for (const query of [{ search: 'widget' }, { search: 'widget', sortBy: 'lastName' }]) {
      const names = (await contactService.findAll(alice.id, query)).data.map((c) => c.firstName);
      expect(names, `leaked with ${JSON.stringify(query)}`).toEqual(['Dana']);
    }
  });

  it('does not leak another user’s contacts through customerId', async () => {
    // customerId comes off the query string; passing someone else's must not
    // bypass the `customer.userId` join on either path.
    const { alice, bob } = await createTwoUsers();
    const bobCustomer = await createCustomer(bob.id);
    await createCustomer(alice.id);
    await createContact(bobCustomer.id, { lastName: 'BobContact' });

    const raw = await contactService.findAll(alice.id, { customerId: bobCustomer.id });
    const prismaPath = await contactService.findAll(alice.id, {
      customerId: bobCustomer.id,
      sortBy: 'lastName',
    });

    expect(raw.data).toHaveLength(0);
    expect(raw.meta.total).toBe(0);
    expect(prismaPath.data).toHaveLength(0);
    expect(prismaPath.meta.total).toBe(0);
  });

  it('does not count another user’s emails in _emailCount', async () => {
    // The email-count subquery is scoped to the caller. Two users can both
    // correspond with the same address; each must only see their own volume.
    const { alice, bob } = await createTwoUsers();
    const aliceCustomer = await createCustomer(alice.id);
    await createContact(aliceCustomer.id, { email: 'shared@corp.test' });
    await createEmail(alice.id, { from: 'shared@corp.test' });
    await createEmail(bob.id, { from: 'shared@corp.test' });
    await createEmail(bob.id, { from: 'shared@corp.test' });

    const raw = await contactService.findAll(alice.id, {});
    const prismaPath = await contactService.findAll(alice.id, { sortBy: 'email' });

    expect(raw.data[0]._emailCount).toBe(1);
    expect(prismaPath.data[0]._emailCount).toBe(1);
  });
});

describe('contactService.findAll — untrusted input handling', () => {
  it('treats a search containing a single quote as a literal', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCustomer = await createCustomer(alice.id);
    const bobCustomer = await createCustomer(bob.id);
    await createContact(aliceCustomer.id, { firstName: "o'brien", lastName: 'Alice side' });
    await createContact(bobCustomer.id, { firstName: "o'brien", lastName: 'Bob side' });

    for (const sortBy of [undefined, 'lastName']) {
      const result = await contactService.findAll(alice.id, { search: "o'brien", sortBy });
      expect(result.data.map((c) => c.lastName)).toEqual(['Alice side']);
    }
  });

  it('does not execute a SQL fragment passed as search', async () => {
    const { alice } = await createTwoUsers();
    const aliceCustomer = await createCustomer(alice.id);
    await createContact(aliceCustomer.id, { lastName: 'Survivor' });

    const injections = [
      "'; DROP TABLE contacts; --",
      "' OR '1'='1",
      "%' OR 1=1 --",
      "'; SELECT pg_sleep(0); --",
    ];

    for (const search of injections) {
      // Both paths: the raw-SQL default and the Prisma orderBy path.
      const raw = await contactService.findAll(alice.id, { search });
      const prismaPath = await contactService.findAll(alice.id, { search, sortBy: 'lastName' });
      // Matched literally, so nothing comes back — and crucially, nothing runs.
      expect(raw.data, `matched for ${search}`).toHaveLength(0);
      expect(prismaPath.data, `matched for ${search}`).toHaveLength(0);
    }

    // The table is still there and still holds the row.
    const after = await contactService.findAll(alice.id, {});
    expect(after.data.map((c) => c.lastName)).toEqual(['Survivor']);
  });

  it('falls back to the default sort for a sortBy that is not whitelisted', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCustomer = await createCustomer(alice.id);
    const bobCustomer = await createCustomer(bob.id);
    await createContact(aliceCustomer.id, { lastName: 'AliceContact' });
    await createContact(bobCustomer.id, { lastName: 'BobContact' });

    // An arbitrary key would be a Prisma error at best and an injection vector
    // at worst, so it must never reach either query.
    const unknownSorts = ['id', 'customerId', 'password', '(SELECT 1)', 'lastName; DROP TABLE contacts'];

    for (const sortBy of unknownSorts) {
      const result = await contactService.findAll(alice.id, { sortBy });
      expect(result.data.map((c) => c.lastName), `sortBy=${sortBy}`).toEqual(['AliceContact']);
    }
  });
});

describe('contactService.findById / findByEmail — tenant isolation', () => {
  it('refuses to return a contact under another user’s customer', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCustomer = await createCustomer(bob.id);
    const bobContact = await createContact(bobCustomer.id, { email: 'bob-contact@corp.test' });

    await expect(contactService.findById(alice.id, bobContact.id)).rejects.toThrow(/not found/i);
    expect(await contactService.findByEmail(alice.id, 'bob-contact@corp.test')).toBeNull();
  });

  it('does not list another user’s contacts by customer id', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCustomer = await createCustomer(bob.id);
    await createContact(bobCustomer.id);

    expect(await contactService.findByCustomerId(alice.id, bobCustomer.id)).toEqual([]);
  });
});
