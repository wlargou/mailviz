import { describe, it, expect } from 'vitest';
import { dealService } from './dealService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createDeal, shareDealWith } from '../test/factories.js';

/**
 * Multi-tenant isolation for deals.
 *
 * The search case is a regression test for a real cross-tenant leak. `findAll`
 * built its where-clause as `{ ...ownershipFilter }`, and ownershipFilter is
 * `{ OR: [...] }` whenever the user has any shared deal — so the search
 * branch's `where.OR = [...]` overwrote the ownership constraint entirely. Any
 * user with at least one shared deal who ran a search saw EVERY user's deals.
 *
 * Two conditions had to coincide, which is why it survived review. It is also
 * why these run against a real Postgres: a mocked Prisma client would have
 * accepted the broken where-clause without complaint.
 */
describe('dealService.findAll — tenant isolation', () => {
  it('returns only deals the caller owns', async () => {
    const { alice, bob } = await createTwoUsers();
    await createDeal(alice.id, { title: 'Alice deal' });
    await createDeal(bob.id, { title: 'Bob deal' });

    const result = await dealService.findAll(alice.id, {});

    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toBe('Alice deal');
  });

  it('includes deals explicitly shared with the caller', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobDeal = await createDeal(bob.id, { title: 'Shared with Alice' });
    await createDeal(bob.id, { title: 'Bob keeps this' });
    await shareDealWith(bobDeal.id, bob.id, alice.id);

    const titles = (await dealService.findAll(alice.id, {})).data.map((d) => d.title);

    expect(titles).toContain('Shared with Alice');
    expect(titles).not.toContain('Bob keeps this');
  });

  it('does not leak other users’ deals when searching — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();

    // The trigger: Alice must have at least one shared deal, so the ownership
    // filter becomes an OR clause that the search branch can overwrite.
    const shared = await createDeal(bob.id, { title: 'Shared widget deal' });
    await shareDealWith(shared.id, bob.id, alice.id);

    await createDeal(alice.id, { title: 'Alice widget deal' });
    await createDeal(bob.id, { title: 'Bob secret widget deal' });

    const titles = (await dealService.findAll(alice.id, { search: 'widget' })).data.map((d) => d.title);

    expect(titles).toContain('Alice widget deal');
    expect(titles).toContain('Shared widget deal');
    // The bug: this used to appear.
    expect(titles).not.toContain('Bob secret widget deal');
  });

  it('keeps the ownership constraint when combining search with other filters', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createDeal(bob.id, { title: 'Shared alpha' });
    await shareDealWith(shared.id, bob.id, alice.id);
    await createDeal(bob.id, { title: 'Bob alpha', status: 'APPROVED' });

    const titles = (
      await dealService.findAll(alice.id, { search: 'alpha', status: 'APPROVED' })
    ).data.map((d) => d.title);

    expect(titles).not.toContain('Bob alpha');
  });

  it('ownership=shared returns only deals the caller does not own', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createDeal(bob.id, { title: 'From Bob' });
    await shareDealWith(shared.id, bob.id, alice.id);
    await createDeal(alice.id, { title: 'Alice own' });

    const titles = (await dealService.findAll(alice.id, { ownership: 'shared' })).data.map((d) => d.title);

    expect(titles).toEqual(['From Bob']);
  });

  it('ownership=owned excludes shared deals', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createDeal(bob.id, { title: 'From Bob' });
    await shareDealWith(shared.id, bob.id, alice.id);
    await createDeal(alice.id, { title: 'Alice own' });

    const titles = (await dealService.findAll(alice.id, { ownership: 'owned' })).data.map((d) => d.title);

    expect(titles).toEqual(['Alice own']);
  });
});

/**
 * Sort-field whitelisting for deals.
 *
 * `sortBy` and `sortOrder` arrive on the query string and used to be spliced
 * into Prisma's `orderBy` unchecked. Prisma rejects an unknown key, so
 * `?sortBy=whatever` was an unhandled 500 that any caller could trigger. Both
 * are now matched against a whitelist and fall back to the default.
 *
 * Deals are the service where a where-clause has already leaked across tenants
 * once, so the fallback is also checked against the ownership filter: an
 * unrecognised sort must change the ordering and nothing else.
 */
const DEAL_SORT_FIELDS = ['title', 'status', 'expiryDate', 'createdAt', 'updatedAt'];

/** Pins createdAt so assertions about the default sort are deterministic. */
async function pinCreatedAt(id: string, iso: string) {
  await prisma.deal.update({ where: { id }, data: { createdAt: new Date(iso) } });
}

describe('dealService.findAll — sort whitelisting', () => {
  it('accepts every whitelisted field in both directions', async () => {
    const { alice } = await createTwoUsers();
    await createDeal(alice.id, { title: 'Alpha' });
    await createDeal(alice.id, { title: 'Beta' });

    for (const sortBy of DEAL_SORT_FIELDS) {
      for (const sortOrder of ['asc', 'desc']) {
        const result = await dealService.findAll(alice.id, { sortBy, sortOrder });
        expect(result.data, `sortBy=${sortBy} sortOrder=${sortOrder}`).toHaveLength(2);
      }
    }
  });

  it('orders by a whitelisted field in the requested direction', async () => {
    const { alice } = await createTwoUsers();
    await createDeal(alice.id, { title: 'Beta' });
    await createDeal(alice.id, { title: 'Alpha' });
    await createDeal(alice.id, { title: 'Gamma' });

    const asc = await dealService.findAll(alice.id, { sortBy: 'title', sortOrder: 'asc' });
    const desc = await dealService.findAll(alice.id, { sortBy: 'title', sortOrder: 'desc' });

    expect(asc.data.map((d) => d.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(desc.data.map((d) => d.title)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('sorts by createdAt descending when no sort is requested', async () => {
    const { alice } = await createTwoUsers();
    const older = await createDeal(alice.id, { title: 'Older' });
    const newer = await createDeal(alice.id, { title: 'Newer' });
    await pinCreatedAt(older.id, '2024-01-01T00:00:00.000Z');
    await pinCreatedAt(newer.id, '2024-06-01T00:00:00.000Z');

    const titles = (await dealService.findAll(alice.id, {})).data.map((d) => d.title);

    expect(titles).toEqual(['Newer', 'Older']);
  });

  it('falls back to the default sort for a sortBy that is not whitelisted', async () => {
    // The regression: an unknown key reached Prisma and threw, so anyone could
    // turn the endpoint into a 500 by appending ?sortBy=whatever.
    const { alice } = await createTwoUsers();
    const older = await createDeal(alice.id, { title: 'Older' });
    const newer = await createDeal(alice.id, { title: 'Newer' });
    await pinCreatedAt(older.id, '2024-01-01T00:00:00.000Z');
    await pinCreatedAt(newer.id, '2024-06-01T00:00:00.000Z');

    // Nonsense, a real-but-not-sortable column, and an injection-shaped key.
    const unknownSorts = ['whatever', 'userId', 'password', '(SELECT 1)', 'title; DROP TABLE deals'];

    for (const sortBy of unknownSorts) {
      const result = await dealService.findAll(alice.id, { sortBy });
      expect(result.data.map((d) => d.title), `sortBy=${sortBy}`).toEqual(['Newer', 'Older']);
    }
  });

  it('falls back to the default direction for a sortOrder that is not asc or desc', async () => {
    const { alice } = await createTwoUsers();
    await createDeal(alice.id, { title: 'Alpha' });
    await createDeal(alice.id, { title: 'Beta' });

    for (const sortOrder of ['sideways', 'ASC', '', 'asc; DROP TABLE deals']) {
      const result = await dealService.findAll(alice.id, { sortBy: 'title', sortOrder });
      expect(result.data.map((d) => d.title), `sortOrder=${sortOrder}`).toEqual(['Beta', 'Alpha']);
    }
  });

  it('keeps the ownership constraint when the sort falls back', async () => {
    // Alice holds a shared deal, so the ownership filter is an OR — the shape
    // that leaked before. An unrecognised sort must not reopen it.
    const { alice, bob } = await createTwoUsers();
    const shared = await createDeal(bob.id, { title: 'Shared with Alice' });
    await shareDealWith(shared.id, bob.id, alice.id);
    await createDeal(alice.id, { title: 'Alice own' });
    await createDeal(bob.id, { title: 'Bob private' });

    type DealQuery = Parameters<typeof dealService.findAll>[1];
    const queries: DealQuery[] = [
      { sortBy: 'userId' },
      { sortBy: 'whatever', sortOrder: 'sideways' },
      { sortBy: 'title; DROP TABLE deals', sortOrder: 'asc', search: 'Bob' },
    ];

    for (const query of queries) {
      const result = await dealService.findAll(alice.id, query);
      const titles = result.data.map((d) => d.title);
      expect(titles, `leaked with ${JSON.stringify(query)}`).not.toContain('Bob private');
      expect(result.meta.total, `over-counted with ${JSON.stringify(query)}`).toBe(titles.length);
    }
  });
});
