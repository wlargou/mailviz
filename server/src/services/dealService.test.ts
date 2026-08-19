import { describe, it, expect } from 'vitest';
import { dealService } from './dealService.js';
import { prisma } from '../lib/prisma.js';
import {
  createTwoUsers,
  createUser,
  createDeal,
  createDealPartner,
  createCustomer,
  shareDealWith,
} from '../test/factories.js';

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

/**
 * Paging, filtering, and the read/write/delete paths.
 *
 * Two asymmetries in this service are easy to lose in a refactor and are
 * therefore asserted directly rather than left implied:
 *
 *  - `update` gates on `canAccessDeal` but `delete` gates on `isDealOwner`.
 *    A user a deal was shared with may edit it and must not be able to destroy
 *    it. Collapsing the two onto one helper — in either direction — is a silent
 *    change to who can delete other people's records.
 *  - `unshareDeal` filters on `sharedByUserId`, so revoking is limited to the
 *    shares you created. Without that filter any user could revoke anyone's.
 */

describe('dealService.findAll — pagination', () => {
  it('pages through the result set without dropping or repeating a row', async () => {
    const { alice } = await createTwoUsers();
    for (const title of ['A deal', 'B deal', 'C deal', 'D deal', 'E deal']) {
      await createDeal(alice.id, { title });
    }

    const pages = await Promise.all(
      ['1', '2', '3'].map((page) =>
        dealService.findAll(alice.id, { page, limit: '2', sortBy: 'title', sortOrder: 'asc' })
      )
    );

    expect(pages.map((p) => p.data.map((d) => d.title))).toEqual([
      ['A deal', 'B deal'],
      ['C deal', 'D deal'],
      ['E deal'],
    ]);
    expect(pages[0]!.meta).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
  });

  it('counts every visible row, not just the ones on the page', async () => {
    // `meta.total` drives the pager. If the count query ever picked up `take`,
    // the UI would report one page and hide the rest of the user's deals.
    const { alice, bob } = await createTwoUsers();
    for (const title of ['One', 'Two', 'Three']) await createDeal(alice.id, { title });
    await createDeal(bob.id, { title: 'Bob deal' });

    const result = await dealService.findAll(alice.id, { limit: '1' });

    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(3);
    expect(result.meta.totalPages).toBe(3);
  });
});

describe('dealService.findAll — filters', () => {
  it('filters by status', async () => {
    const { alice } = await createTwoUsers();
    await createDeal(alice.id, { title: 'Approved one', status: 'APPROVED' });
    await createDeal(alice.id, { title: 'Declined one', status: 'DECLINED' });

    const titles = (await dealService.findAll(alice.id, { status: 'APPROVED' })).data.map((d) => d.title);

    expect(titles).toEqual(['Approved one']);
  });

  it('filters by partner', async () => {
    const { alice } = await createTwoUsers();
    const partner = await createDealPartner(alice.id, 'Chosen partner');
    await createDeal(alice.id, { title: 'With partner', partnerId: partner.id });
    await createDeal(alice.id, { title: 'Other partner' });

    const result = await dealService.findAll(alice.id, { partnerId: partner.id });

    expect(result.data.map((d) => d.title)).toEqual(['With partner']);
    expect(result.data[0]!.partner.name).toBe('Chosen partner');
  });

  it('cannot reach another user’s deals by filtering on their partner id', async () => {
    // partnerId is an unvalidated id off the query string. The ownership filter
    // under AND is the only thing stopping it becoming a read of Bob's pipeline.
    const { alice, bob } = await createTwoUsers();
    const bobPartner = await createDealPartner(bob.id, 'Bob partner');
    await createDeal(bob.id, { title: 'Bob private', partnerId: bobPartner.id });

    const result = await dealService.findAll(alice.id, { partnerId: bobPartner.id });

    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });

  it('searches the products field, not only the title', async () => {
    const { alice } = await createTwoUsers();
    await createDeal(alice.id, { title: 'Unrelated title', products: 'Storage arrays' });
    await createDeal(alice.id, { title: 'Another deal', products: 'Laptops' });

    const titles = (await dealService.findAll(alice.id, { search: 'storage' })).data.map((d) => d.title);

    expect(titles).toEqual(['Unrelated title']);
  });

  it('searches the linked company name', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { name: 'Northwind Traders' });
    const deal = await createDeal(alice.id, { title: 'Unrelated title' });
    await prisma.deal.update({ where: { id: deal.id }, data: { customerId: customer.id } });
    await createDeal(alice.id, { title: 'Unmatched deal' });

    const titles = (await dealService.findAll(alice.id, { search: 'northwind' })).data.map((d) => d.title);

    expect(titles).toEqual(['Unrelated title']);
  });
});

describe('dealService.findById', () => {
  it('returns the deal with its partner and company attached', async () => {
    const { alice } = await createTwoUsers();
    const partner = await createDealPartner(alice.id, 'Acme Distribution');
    const customer = await createCustomer(alice.id, { name: 'Northwind Traders' });
    const created = await createDeal(alice.id, { title: 'Renewal', partnerId: partner.id });
    await prisma.deal.update({ where: { id: created.id }, data: { customerId: customer.id } });

    const deal = await dealService.findById(alice.id, created.id);

    expect(deal.title).toBe('Renewal');
    expect(deal.partner.name).toBe('Acme Distribution');
    expect(deal.customer?.name).toBe('Northwind Traders');
  });

  it('refuses to return another user’s deal', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobDeal = await createDeal(bob.id, { title: 'Bob only' });

    await expect(dealService.findById(alice.id, bobDeal.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns a deal shared with the caller', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobDeal = await createDeal(bob.id, { title: 'Shared' });
    await shareDealWith(bobDeal.id, bob.id, alice.id);

    const deal = await dealService.findById(alice.id, bobDeal.id);

    expect(deal.title).toBe('Shared');
  });

  it('throws 404 for an id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    await expect(
      dealService.findById(alice.id, '00000000-0000-0000-0000-000000000000')
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('dealService.create', () => {
  it('stores the deal against the caller', async () => {
    const { alice } = await createTwoUsers();
    const partner = await createDealPartner(alice.id);

    const deal = await dealService.create(alice.id, {
      title: 'New business',
      partnerId: partner.id,
      status: 'TO_CHALLENGE',
    });

    expect(deal.userId).toBe(alice.id);
    expect(deal.title).toBe('New business');
    expect(deal.partner.id).toBe(partner.id);
  });

  it('refuses another account\'s partner', async () => {
    // `partnerId` is a plain FK the database will happily accept across
    // tenants, and `dealIncludes` reads the partner straight back out — so
    // without the check the response hands the caller the name and logo of a
    // partner they have no access to.
    const { alice, bob } = await createTwoUsers();
    const theirPartner = await createDealPartner(bob.id);

    await expect(
      dealService.create(alice.id, {
        title: 'Borrowed',
        partnerId: theirPartner.id,
        status: 'TO_CHALLENGE',
      })
    ).rejects.toMatchObject({ statusCode: 404, code: 'DEAL_PARTNER_NOT_FOUND' });

    expect(await prisma.deal.count({ where: { userId: alice.id } })).toBe(0);
  });

  it('refuses another account\'s company', async () => {
    const { alice, bob } = await createTwoUsers();
    const partner = await createDealPartner(alice.id);
    const theirCustomer = await createCustomer(bob.id);

    await expect(
      dealService.create(alice.id, {
        title: 'Borrowed company',
        partnerId: partner.id,
        customerId: theirCustomer.id,
        status: 'TO_CHALLENGE',
      })
    ).rejects.toMatchObject({ statusCode: 404, code: 'CUSTOMER_NOT_FOUND' });
  });

  it('stores empty optional fields as null rather than empty strings', async () => {
    // An empty string is not "no value": it sorts, matches `contains ''`, and
    // reads as a present-but-blank field everywhere downstream.
    const { alice } = await createTwoUsers();
    const partner = await createDealPartner(alice.id);

    const deal = await dealService.create(alice.id, {
      title: 'Blank fields',
      partnerId: partner.id,
      status: 'TO_CHALLENGE',
      products: '',
      notes: '',
    });

    expect(deal.products).toBeNull();
    expect(deal.notes).toBeNull();
  });

  it('parses an ISO expiry date into a real Date', async () => {
    const { alice } = await createTwoUsers();
    const partner = await createDealPartner(alice.id);

    const deal = await dealService.create(alice.id, {
      title: 'Expires',
      partnerId: partner.id,
      status: 'TO_CHALLENGE',
      expiryDate: '2026-12-31T00:00:00.000Z',
    });

    expect(deal.expiryDate).toEqual(new Date('2026-12-31T00:00:00.000Z'));
  });
});

describe('dealService.update', () => {
  it('updates a deal the caller owns', async () => {
    const { alice } = await createTwoUsers();
    const deal = await createDeal(alice.id, { title: 'Before', status: 'TO_CHALLENGE' });

    const updated = await dealService.update(alice.id, deal.id, { title: 'After', status: 'APPROVED' });

    expect(updated.title).toBe('After');
    expect(updated.status).toBe('APPROVED');
  });

  it('lets a user the deal was shared with edit it', async () => {
    // Deliberate: `update` gates on canAccessDeal, so a share is edit access.
    const { alice, bob } = await createTwoUsers();
    const bobDeal = await createDeal(bob.id, { title: 'Bob deal' });
    await shareDealWith(bobDeal.id, bob.id, alice.id);

    const updated = await dealService.update(alice.id, bobDeal.id, { notes: 'Alice was here' });

    expect(updated.notes).toBe('Alice was here');
    // …but the deal is still Bob's.
    expect(updated.userId).toBe(bob.id);
  });

  it('refuses to update another user’s deal and leaves it untouched', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobDeal = await createDeal(bob.id, { title: 'Bob only', status: 'TO_CHALLENGE' });

    await expect(
      dealService.update(alice.id, bobDeal.id, { title: 'Hijacked', status: 'APPROVED' })
    ).rejects.toMatchObject({ statusCode: 404 });

    const after = await prisma.deal.findUniqueOrThrow({ where: { id: bobDeal.id } });
    expect(after.title).toBe('Bob only');
    expect(after.status).toBe('TO_CHALLENGE');
  });

  it('throws 404 for an id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    await expect(
      dealService.update(alice.id, '00000000-0000-0000-0000-000000000000', { title: 'Nope' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('clears a field when it is set to an empty string', async () => {
    const { alice } = await createTwoUsers();
    const deal = await createDeal(alice.id, { title: 'Has products', products: 'Laptops' });

    const updated = await dealService.update(alice.id, deal.id, { products: '' });

    expect(updated.products).toBeNull();
  });
});

describe('dealService.delete', () => {
  it('deletes a deal the caller owns', async () => {
    const { alice } = await createTwoUsers();
    const deal = await createDeal(alice.id, { title: 'Going away' });

    await dealService.delete(alice.id, deal.id);

    expect(await prisma.deal.findUnique({ where: { id: deal.id } })).toBeNull();
  });

  it('refuses to delete another user’s deal and leaves it in place', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobDeal = await createDeal(bob.id, { title: 'Bob only' });

    await expect(dealService.delete(alice.id, bobDeal.id)).rejects.toMatchObject({ statusCode: 404 });

    expect(await prisma.deal.findUnique({ where: { id: bobDeal.id } })).not.toBeNull();
  });

  it('does not let a user the deal was shared with delete it', async () => {
    // The asymmetry that matters: a share grants edit, never destroy. If
    // `delete` ever switched from isDealOwner to canAccessDeal, every recipient
    // of a share would silently gain the power to erase the owner's record.
    const { alice, bob } = await createTwoUsers();
    const bobDeal = await createDeal(bob.id, { title: 'Bob deal' });
    await shareDealWith(bobDeal.id, bob.id, alice.id);

    await expect(dealService.delete(alice.id, bobDeal.id)).rejects.toMatchObject({ statusCode: 404 });

    expect(await prisma.deal.findUnique({ where: { id: bobDeal.id } })).not.toBeNull();
  });

  it('throws 404 for an id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    await expect(
      dealService.delete(alice.id, '00000000-0000-0000-0000-000000000000')
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('dealService — sharing', () => {
  it('records a share and is idempotent when repeated', async () => {
    const { alice, bob } = await createTwoUsers();
    const deal = await createDeal(alice.id, { title: 'To share' });

    await dealService.shareDeal(alice.id, deal.id, [bob.id]);
    const second = await dealService.shareDeal(alice.id, deal.id, [bob.id]);

    expect(second.sharedWith).toBe(1);
    expect(await prisma.dealShare.count({ where: { dealId: deal.id } })).toBe(1);
  });

  it('refuses to share a deal the caller does not own', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    const bobDeal = await createDeal(bob.id, { title: 'Bob deal' });
    await shareDealWith(bobDeal.id, bob.id, alice.id);

    await expect(dealService.shareDeal(alice.id, bobDeal.id, [carol.id])).rejects.toMatchObject({
      status: 404,
    });

    expect(await prisma.dealShare.count({ where: { sharedWithUserId: carol.id } })).toBe(0);
  });

  it('refuses to share a deal with only yourself', async () => {
    const { alice } = await createTwoUsers();
    const deal = await createDeal(alice.id, { title: 'Mine' });

    await expect(dealService.shareDeal(alice.id, deal.id, [alice.id])).rejects.toMatchObject({
      status: 400,
    });
  });

  it('refuses to list the shares of a deal the caller does not own', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobDeal = await createDeal(bob.id, { title: 'Bob deal' });
    await shareDealWith(bobDeal.id, bob.id, alice.id);

    await expect(dealService.getDealShares(alice.id, bobDeal.id)).rejects.toMatchObject({ status: 404 });
  });

  it('lists only the shares the caller created', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    const deal = await createDeal(alice.id, { title: 'Mine' });
    await shareDealWith(deal.id, alice.id, bob.id);
    await shareDealWith(deal.id, alice.id, carol.id);

    const shares = await dealService.getDealShares(alice.id, deal.id);

    expect(shares.map((s) => s.sharedWith.id).sort()).toEqual([bob.id, carol.id].sort());
  });

  it('cannot revoke a share somebody else created', async () => {
    // `unshareDeal` never checks ownership — the only thing that stops a third
    // party revoking Alice's shares is the `sharedByUserId` filter.
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    const deal = await createDeal(alice.id, { title: 'Alice deal' });
    await shareDealWith(deal.id, alice.id, carol.id);

    await dealService.unshareDeal(bob.id, deal.id, carol.id);

    expect(await prisma.dealShare.count({ where: { dealId: deal.id, sharedWithUserId: carol.id } })).toBe(1);
  });

  it('revokes a share the caller created', async () => {
    const { alice, bob } = await createTwoUsers();
    const deal = await createDeal(alice.id, { title: 'Alice deal' });
    await shareDealWith(deal.id, alice.id, bob.id);

    await dealService.unshareDeal(alice.id, deal.id, bob.id);

    expect(await prisma.dealShare.count({ where: { dealId: deal.id } })).toBe(0);
    // The deal itself is untouched — unsharing is not deleting.
    expect(await prisma.deal.findUnique({ where: { id: deal.id } })).not.toBeNull();
  });
});
