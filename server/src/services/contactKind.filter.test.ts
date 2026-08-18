import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createUser, createTwoUsers, createCustomer } from '../test/factories.js';
import { contactService } from './contactService.js';
import { customerService } from './customerService.js';

/** The `kind` filter, and that ingest classifies without being asked to. */

async function seed(userId: string) {
  const customer = await createCustomer(userId, { name: 'Acme', domain: 'acme.test' });
  const rows: Array<[string, string]> = [
    ['hamid.fahmy@acme.test', 'person'],
    ['nada.drissi@acme.test', 'person'],
    ['support@acme.test', 'role'],
    ['noreply@acme.test', 'automated'],
  ];
  for (const [email, kind] of rows) {
    await prisma.contact.create({
      data: { customerId: customer.id, firstName: 'A', lastName: 'B', email, kind },
    });
  }
  return customer;
}

describe('contactService.findAll — kind filter', () => {
  it('returns everything when no kind is given', async () => {
    const user = await createUser();
    await seed(user.id);
    const { data } = await contactService.findAll(user.id, { sortBy: 'email', sortOrder: 'asc' });
    expect(data).toHaveLength(4);
  });

  it('"people" means a human answers it — person or role, never a machine', async () => {
    const user = await createUser();
    await seed(user.id);
    const { data } = await contactService.findAll(user.id, {
      kind: 'people',
      sortBy: 'email',
      sortOrder: 'asc',
    });
    expect(data.map((c) => c.email).sort()).toEqual([
      'hamid.fahmy@acme.test',
      'nada.drissi@acme.test',
      'support@acme.test',
    ]);
  });

  it.each(['person', 'role', 'automated'])('filters to %s exactly', async (kind) => {
    const user = await createUser();
    await seed(user.id);
    const { data } = await contactService.findAll(user.id, { kind, sortBy: 'email', sortOrder: 'asc' });
    expect(data.every((c) => (c as { kind: string }).kind === kind)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it('ignores an unrecognised kind rather than returning nothing', async () => {
    const user = await createUser();
    await seed(user.id);
    // The value reaches this straight off the query string.
    const { data } = await contactService.findAll(user.id, { kind: "'; DROP TABLE contacts; --" });
    expect(data).toHaveLength(4);
  });

  it('applies on the emailCount sort too, which is a separate raw-SQL query', async () => {
    const user = await createUser();
    await seed(user.id);
    // No sortBy: falls through to the emailCount branch.
    const { data } = await contactService.findAll(user.id, { kind: 'people' });
    expect(data).toHaveLength(3);
  });

  it('does not leak another account contacts', async () => {
    const { alice, bob } = await createTwoUsers();
    await seed(bob.id);
    const { data } = await contactService.findAll(alice.id, { kind: 'people' });
    expect(data).toHaveLength(0);
  });
});

describe('findOrCreateContact classifies on the way in', () => {
  it.each([
    ['noreply@acme.test', 'automated'],
    ['support@acme.test', 'role'],
    ['hamid.fahmy@acme.test', 'person'],
  ])('%s is stored as %s', async (email, expected) => {
    const user = await createUser();
    const customer = await createCustomer(user.id, { name: 'Acme', domain: 'acme.test' });

    const { contact } = await customerService.findOrCreateContact(user.id, email, null, customer.id);

    expect(contact.kind).toBe(expected);
  });
});

describe('engagement — maintained by sync, filterable on the list', () => {
  it.each([
    ['any', ['both@acme.test', 'recv@acme.test', 'send@acme.test']],
    ['both', ['both@acme.test']],
    ['sender', ['send@acme.test']],
    ['receiver', ['recv@acme.test']],
    ['none', ['bystander@acme.test']],
  ])('filters to %s', async (engagement, expected) => {
    const user = await createUser();
    const customer = await createCustomer(user.id, { name: 'Acme', domain: 'acme.test' });
    for (const [email, value] of [
      ['both@acme.test', 'both'],
      ['send@acme.test', 'sender'],
      ['recv@acme.test', 'receiver'],
      ['bystander@acme.test', 'none'],
    ] as const) {
      await prisma.contact.create({
        data: { customerId: customer.id, firstName: 'A', lastName: 'B', email, engagement: value },
      });
    }

    const { data } = await contactService.findAll(user.id, {
      engagement,
      sortBy: 'email',
      sortOrder: 'asc',
    });
    expect(data.map((c) => c.email).sort()).toEqual([...expected].sort());
  });

  it('ignores an unrecognised engagement rather than returning nothing', async () => {
    const user = await createUser();
    const customer = await createCustomer(user.id, { name: 'Acme', domain: 'acme.test' });
    await prisma.contact.create({
      data: { customerId: customer.id, firstName: 'A', lastName: 'B', email: 'x@acme.test' },
    });

    const { data } = await contactService.findAll(user.id, { engagement: "' OR 1=1 --" });
    expect(data).toHaveLength(1);
  });

  it('combines with the kind filter rather than replacing it', async () => {
    const user = await createUser();
    const customer = await createCustomer(user.id, { name: 'Acme', domain: 'acme.test' });
    await prisma.contact.create({
      data: { customerId: customer.id, firstName: 'A', lastName: 'B', email: 'person@acme.test', kind: 'person', engagement: 'both' },
    });
    await prisma.contact.create({
      data: { customerId: customer.id, firstName: 'A', lastName: 'B', email: 'noreply@acme.test', kind: 'automated', engagement: 'both' },
    });

    const { data } = await contactService.findAll(user.id, { kind: 'people', engagement: 'both' });
    expect(data.map((c) => c.email)).toEqual(['person@acme.test']);
  });
});
