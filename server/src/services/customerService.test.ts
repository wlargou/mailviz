import { describe, it, expect } from 'vitest';
import { customerService } from './customerService.js';
import { createTwoUsers, createCustomer, createContact } from '../test/factories.js';

/**
 * Multi-tenant isolation for customers.
 *
 * `findAll` puts the search terms in `where.OR` while ownership lives in
 * `where.userId` — separate keys, so the assignment cannot clobber ownership
 * the way it did in `dealService.findAll`. That is a property worth pinning
 * down rather than assuming: the fix for deals was to move ownership out of
 * `OR`, and this test is what stops customers from drifting the other way.
 */
describe('customerService.findAll — tenant isolation', () => {
  it('returns only the caller’s customers', async () => {
    const { alice, bob } = await createTwoUsers();
    await createCustomer(alice.id, { name: 'Alice Corp' });
    await createCustomer(bob.id, { name: 'Bob Corp' });

    const result = await customerService.findAll(alice.id, {});

    expect(result.data.map((c) => c.name)).toEqual(['Alice Corp']);
    expect(result.meta.total).toBe(1);
  });

  it('does not leak other users’ customers when searching', async () => {
    const { alice, bob } = await createTwoUsers();
    await createCustomer(alice.id, { name: 'Alice Widget Ltd' });
    await createCustomer(bob.id, { name: 'Bob Widget Ltd' });

    const result = await customerService.findAll(alice.id, { search: 'widget' });

    expect(result.data.map((c) => c.name)).toEqual(['Alice Widget Ltd']);
    expect(result.meta.total).toBe(1);
  });

  it('keeps ownership when search is combined with sorting and pagination', async () => {
    const { alice, bob } = await createTwoUsers();
    await createCustomer(alice.id, { name: 'Alice Widget Ltd' });
    await createCustomer(bob.id, { name: 'Bob Widget One' });
    await createCustomer(bob.id, { name: 'Bob Widget Two' });

    type CustomerQuery = Parameters<typeof customerService.findAll>[1];
    const combinations: CustomerQuery[] = [
      { search: 'widget' },
      { search: 'widget', sortBy: 'name', sortOrder: 'asc' },
      { search: 'widget', sortBy: 'emailCount' },
      { search: 'widget', page: '1', limit: '100' },
    ];

    for (const query of combinations) {
      const names = (await customerService.findAll(alice.id, query)).data.map((c) => c.name);
      expect(names, `leaked with ${JSON.stringify(query)}`).toEqual(['Alice Widget Ltd']);
    }
  });

  it('treats a search containing SQL syntax as a literal', async () => {
    const { alice } = await createTwoUsers();
    await createCustomer(alice.id, { name: 'Survivor Corp' });

    const result = await customerService.findAll(alice.id, { search: "'; DROP TABLE customers; --" });

    expect(result.data).toHaveLength(0);
    expect((await customerService.findAll(alice.id, {})).data.map((c) => c.name)).toEqual([
      'Survivor Corp',
    ]);
  });

  it('does not leak another user’s customers through categoryId', async () => {
    const { alice, bob } = await createTwoUsers();
    await createCustomer(bob.id, { name: 'Bob Corp' });
    await createCustomer(alice.id, { name: 'Alice Corp' });

    const result = await customerService.findAll(alice.id, { categoryId: 'no-such-category' });

    expect(result.data).toHaveLength(0);
  });
});

describe('customerService.findById — tenant isolation', () => {
  it('refuses to return another user’s customer', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCustomer = await createCustomer(bob.id);

    await expect(customerService.findById(alice.id, bobCustomer.id)).rejects.toThrow(/not found/i);
  });

  it('refuses to update or delete another user’s customer', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCustomer = await createCustomer(bob.id, { name: 'Bob Corp' });

    await expect(customerService.update(alice.id, bobCustomer.id, { name: 'Hijacked' })).rejects.toThrow(
      /not found/i
    );
    await expect(customerService.delete(alice.id, bobCustomer.id)).rejects.toThrow(/not found/i);

    const stillThere = await customerService.findById(bob.id, bobCustomer.id);
    expect(stillThere.name).toBe('Bob Corp');
  });
});

describe('customerService.findOrCreateByDomain — tenant isolation', () => {
  it('does not hand back another user’s customer for the same domain', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCustomer = await createCustomer(bob.id, { name: 'Bob Corp', domain: 'shared-domain.test' });

    const { customer, created } = await customerService.findOrCreateByDomain(alice.id, 'shared-domain.test');

    expect(created).toBe(true);
    expect(customer.id).not.toBe(bobCustomer.id);
    expect(customer.userId).toBe(alice.id);
  });
});

describe('customerService.findAttachments / findLinkedEvents — tenant isolation', () => {
  it('returns nothing for a customer the caller does not own', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCustomer = await createCustomer(bob.id);
    await createContact(bobCustomer.id);

    expect(await customerService.findAttachments(alice.id, bobCustomer.id)).toEqual([]);
    expect(await customerService.findLinkedEvents(alice.id, bobCustomer.id)).toEqual([]);
  });
});
