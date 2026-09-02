import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { customerService } from './customerService.js';
import { contactMergeService } from './contactMergeService.js';
import { createTwoUsers, createCustomer, createContact, createEmail } from '../test/factories.js';

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

/**
 * Sort-field whitelisting for customers.
 *
 * `sortBy` and `sortOrder` arrive on the query string and used to be spliced
 * into Prisma's `orderBy` unchecked. Prisma rejects an unknown key, so
 * `?sortBy=whatever` was an unhandled 500 that any caller could trigger. Both
 * are now matched against a whitelist and fall back to the default.
 *
 * The default, `emailCount`, is not a column — it is an ordering over the
 * related email rows — so it is deliberately absent from the whitelist and
 * handled by its own branch. That makes it the one sort that has to be
 * exercised through data rather than through the list, which is what the
 * email-count test below does.
 */
const CUSTOMER_SORT_FIELDS = ['name', 'company', 'email', 'domain', 'isVip', 'createdAt', 'updatedAt'];

describe('customerService.findAll — sort whitelisting', () => {
  it('accepts every whitelisted field in both directions', async () => {
    const { alice } = await createTwoUsers();
    await createCustomer(alice.id, { name: 'Alpha Corp' });
    await createCustomer(alice.id, { name: 'Beta Corp' });

    for (const sortBy of [...CUSTOMER_SORT_FIELDS, 'emailCount']) {
      for (const sortOrder of ['asc', 'desc']) {
        const result = await customerService.findAll(alice.id, { sortBy, sortOrder });
        expect(result.data, `sortBy=${sortBy} sortOrder=${sortOrder}`).toHaveLength(2);
      }
    }
  });

  it('orders by a whitelisted field in the requested direction', async () => {
    const { alice } = await createTwoUsers();
    await createCustomer(alice.id, { name: 'Beta Corp' });
    await createCustomer(alice.id, { name: 'Alpha Corp' });
    await createCustomer(alice.id, { name: 'Gamma Corp' });

    const asc = await customerService.findAll(alice.id, { sortBy: 'name', sortOrder: 'asc' });
    const desc = await customerService.findAll(alice.id, { sortBy: 'name', sortOrder: 'desc' });

    expect(asc.data.map((c) => c.name)).toEqual(['Alpha Corp', 'Beta Corp', 'Gamma Corp']);
    expect(desc.data.map((c) => c.name)).toEqual(['Gamma Corp', 'Beta Corp', 'Alpha Corp']);
  });

  it('sorts by email count descending when no sort is requested', async () => {
    const { alice } = await createTwoUsers();
    const busy = await createCustomer(alice.id, { name: 'Busy Corp' });
    await createCustomer(alice.id, { name: 'Quiet Corp' });
    await createEmail(alice.id, { customerId: busy.id });
    await createEmail(alice.id, { customerId: busy.id });

    const result = await customerService.findAll(alice.id, {});

    expect(result.data.map((c) => c.name)).toEqual(['Busy Corp', 'Quiet Corp']);
    expect(result.data[0]._count.emails).toBe(2);
  });

  it('falls back to the default sort for a sortBy that is not whitelisted', async () => {
    // The regression: an unknown key reached Prisma and threw, so anyone could
    // turn the endpoint into a 500 by appending ?sortBy=whatever.
    const { alice } = await createTwoUsers();
    const busy = await createCustomer(alice.id, { name: 'Busy Corp' });
    await createCustomer(alice.id, { name: 'Quiet Corp' });
    await createEmail(alice.id, { customerId: busy.id });

    // Nonsense, a real-but-not-sortable column, and an injection-shaped key.
    const unknownSorts = ['whatever', 'userId', 'password', '(SELECT 1)', 'name; DROP TABLE customers'];

    for (const sortBy of unknownSorts) {
      const result = await customerService.findAll(alice.id, { sortBy });
      expect(result.data.map((c) => c.name), `sortBy=${sortBy}`).toEqual(['Busy Corp', 'Quiet Corp']);
    }
  });

  it('falls back to the default direction for a sortOrder that is not asc or desc', async () => {
    const { alice } = await createTwoUsers();
    await createCustomer(alice.id, { name: 'Alpha Corp' });
    await createCustomer(alice.id, { name: 'Beta Corp' });

    for (const sortOrder of ['sideways', 'ASC', '', 'asc; DROP TABLE customers']) {
      const result = await customerService.findAll(alice.id, { sortBy: 'name', sortOrder });
      expect(result.data.map((c) => c.name), `sortOrder=${sortOrder}`).toEqual(['Beta Corp', 'Alpha Corp']);
    }
  });

  it('keeps the ownership constraint when the sort falls back', async () => {
    // Falling back must not become a way around the where-clause.
    const { alice, bob } = await createTwoUsers();
    await createCustomer(alice.id, { name: 'Alice Corp' });
    await createCustomer(bob.id, { name: 'Bob Corp' });

    type CustomerQuery = Parameters<typeof customerService.findAll>[1];
    const queries: CustomerQuery[] = [
      { sortBy: 'userId' },
      { sortBy: 'whatever', sortOrder: 'sideways' },
      { sortBy: 'name; DROP TABLE customers', sortOrder: 'asc', search: 'Corp' },
    ];

    for (const query of queries) {
      const result = await customerService.findAll(alice.id, query);
      expect(result.data.map((c) => c.name), `leaked with ${JSON.stringify(query)}`).toEqual(['Alice Corp']);
      expect(result.meta.total, `over-counted with ${JSON.stringify(query)}`).toBe(1);
    }
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


describe('customerService — cross-tenant foreign keys', () => {
  it('refuses another account category on create — and does not echo it back', async () => {
    // `categoryId` is a plain uuid in the request body and a foreign key into a
    // user-scoped table, so the database accepts a stranger's id. Both create
    // and update `include: { category: true }`, so the response would hand the
    // caller the name and colour of a category they cannot otherwise see. The
    // same check already guards the equivalent FKs on deals and tasks.
    const { alice, bob } = await createTwoUsers();
    const bobCategory = await prisma.companyCategory.create({
      data: { userId: bob.id, name: 'SECRET', label: 'Bob secret category' },
    });

    await expect(
      customerService.create(alice.id, { name: 'Probe', categoryId: bobCategory.id } as never)
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(await prisma.customer.count({ where: { userId: alice.id } })).toBe(0);
  });

  it('refuses another account category on update', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createCustomer(alice.id);
    const bobCategory = await prisma.companyCategory.create({
      data: { userId: bob.id, name: 'SECRET', label: 'Bob secret category' },
    });

    await expect(
      customerService.update(alice.id, mine.id, { categoryId: bobCategory.id } as never)
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: mine.id } })).categoryId
    ).toBeNull();
  });

  it('still accepts the caller own category', async () => {
    const { alice } = await createTwoUsers();
    const mine = await prisma.companyCategory.create({
      data: { userId: alice.id, name: 'PARTNER', label: 'Partner' },
    });

    const created = await customerService.create(alice.id, {
      name: 'Acme',
      categoryId: mine.id,
    } as never);

    expect(created.categoryId).toBe(mine.id);
  });
});

/**
 * A merge has to survive the next sync.
 *
 * `findOrCreateContact` runs for every address on every synced message and
 * creates a contact when it does not recognise one. Merging moves the discarded
 * row's addresses into `contact_email_aliases` and deletes the row — so if the
 * lookup only considers the primary address, the very next email from a merged
 * address recreates the duplicate. The user's merge is undone within a minute,
 * with nothing to indicate it happened.
 *
 * These go through the real merge rather than inserting alias rows by hand, so
 * they still hold if the merge changes how it stores them.
 */
describe('customerService.findOrCreateContact — merged addresses', () => {
  async function mergedPair(userId: string) {
    const customer = await createCustomer(userId, { domain: 'corp.test' });
    const target = await createContact(customer.id, {
      firstName: 'Bob',
      lastName: 'Smith',
      email: 'bob.smith@corp.test',
    });
    const source = await createContact(customer.id, {
      firstName: 'Bob',
      lastName: 'Smith',
      email: 'b.smith@corp.test',
    });
    await contactMergeService.merge(userId, { targetId: target.id, sourceIds: [source.id] });
    return { customer, target };
  }

  it('finds the survivor by an address the merge absorbed', async () => {
    const { alice } = await createTwoUsers();
    const { customer, target } = await mergedPair(alice.id);

    const { contact, created } = await customerService.findOrCreateContact(
      alice.id,
      'b.smith@corp.test',
      'Bob Smith',
      customer.id
    );

    expect(created).toBe(false);
    expect(contact.id).toBe(target.id);
    // The real regression: a third row appearing where the user left one.
    expect(await prisma.contact.count({ where: { customerId: customer.id } })).toBe(1);
  });

  it('still creates a contact for an address nobody has seen', async () => {
    // Without this the alias lookup could match far too broadly and the sync
    // would stop discovering people at all.
    const { alice } = await createTwoUsers();
    const { customer } = await mergedPair(alice.id);

    const { created } = await customerService.findOrCreateContact(
      alice.id,
      'carol@corp.test',
      'Carol',
      customer.id
    );

    expect(created).toBe(true);
    expect(await prisma.contact.count({ where: { customerId: customer.id } })).toBe(2);
  });

  it('does not match an alias belonging to another tenant', async () => {
    // The alias lookup adds an OR, which is exactly the shape that has dropped
    // the ownership filter twice in this codebase.
    const { alice, bob } = await createTwoUsers();
    await mergedPair(alice.id);
    const bobCustomer = await createCustomer(bob.id, { domain: 'corp.test' });

    const { contact, created } = await customerService.findOrCreateContact(
      bob.id,
      'b.smith@corp.test',
      'Bob Smith',
      bobCustomer.id
    );

    expect(created).toBe(true);
    expect(contact.customerId).toBe(bobCustomer.id);
  });

  it('does not create a second row for a different-cased address', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'corp.test' });
    const existing = await createContact(customer.id, { email: 'dana@corp.test' });

    const { contact, created } = await customerService.findOrCreateContact(
      alice.id,
      'Dana@Corp.test',
      'Dana',
      customer.id
    );

    expect(created).toBe(false);
    expect(contact.id).toBe(existing.id);
  });
});

describe('customerService — a duplicate domain is a conflict, not a crash', () => {
  it('answers 409 rather than letting P2002 fall through to a 500', () => {
    // `(userId, domain)` is unique, and nothing pre-checked it — so creating a
    // company with a domain you already have returned INTERNAL_ERROR. Measured
    // against the running app before the fix, not inferred.
    //
    // Handled here rather than by mapping P2002 in errorHandler: the same
    // constraint is hit by findOrCreateByDomain, which the email and calendar
    // schedulers race on. That collision is our bug, and has to stay a loud,
    // logged 500. Middleware sees an identical error for both.
    return (async () => {
      const { alice } = await createTwoUsers();
      await customerService.create(alice.id, { name: 'Acme', domain: 'acme.example' });

      const err = await customerService
        .create(alice.id, { name: 'Acme again', domain: 'acme.example' })
        .then(() => null)
        .catch((e: { statusCode?: number; code?: string }) => e);

      // Not a bare rejects.toThrow(): the unfixed code also throws, so that
      // assertion would pass without the fix.
      expect(err?.statusCode).toBe(409);
      expect(err?.code).toBe('CUSTOMER_EXISTS');
    })();
  });

  it('lets two companies share an absent domain', async () => {
    // cleanEmptyStrings turns '' into NULL, and Postgres does not consider two
    // NULLs equal — so the unique does not collapse every domain-less company
    // into one. Guards the normalisation this relies on.
    const { alice } = await createTwoUsers();

    await customerService.create(alice.id, { name: 'One', domain: '' });
    const second = await customerService.create(alice.id, { name: 'Two', domain: '' });

    expect(second.id).toBeTruthy();
    const rows = await prisma.customer.findMany({ where: { userId: alice.id, domain: null } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});

