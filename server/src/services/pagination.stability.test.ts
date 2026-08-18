import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createUser, createCustomer, createDeal, createTask } from '../test/factories.js';
import { contactService } from './contactService.js';
import { customerService } from './customerService.js';
import { dealService } from './dealService.js';
import { taskService } from './taskService.js';

/**
 * Paging through a list must visit every row exactly once.
 *
 * Each page is its own `LIMIT`/`OFFSET` query, and when rows tie on the sort
 * column Postgres may order them differently for each one — so a row shows up on
 * page 1 and again on page 3 while another is unreachable. Reported from the
 * Contacts page, where 3,499 of 11,694 contacts share an empty surname: a single
 * tie group about 175 pages deep.
 *
 * Every fixture below is built so that *all* rows tie on the sort column, which
 * is the condition the bug needs.
 */

async function pageThrough(
  fetchPage: (page: number) => Promise<{ data: Array<{ id: string }> }>,
  pages: number
): Promise<string[]> {
  const seen: string[] = [];
  for (let page = 1; page <= pages; page++) {
    const result = await fetchPage(page);
    seen.push(...result.data.map((row) => row.id));
  }
  return seen;
}

function assertEveryRowOnce(seen: string[], expected: number) {
  expect(seen).toHaveLength(expected);
  expect(new Set(seen).size).toBe(expected);
}

describe('list pagination is stable when rows tie on the sort column', () => {
  it('contacts — every row exactly once, sorted by a column they all share', async () => {
    const user = await createUser();
    const customer = await createCustomer(user.id);
    // Identical surname on every row: one tie group covering the whole list.
    for (let i = 0; i < 25; i++) {
      await prisma.contact.create({
        data: { customerId: customer.id, firstName: `Person${i}`, lastName: '', email: `p${i}@acme.test` },
      });
    }

    const seen = await pageThrough(
      (page) =>
        contactService.findAll(user.id, {
          page: String(page),
          limit: '5',
          sortBy: 'lastName',
          sortOrder: 'asc',
        }) as Promise<{ data: Array<{ id: string }> }>,
      5
    );

    assertEveryRowOnce(seen, 25);
  });

  it('contacts — also stable on the emailCount branch, which is raw SQL', async () => {
    const user = await createUser();
    const customer = await createCustomer(user.id);
    // No mail for anyone, so every row ties at zero.
    for (let i = 0; i < 25; i++) {
      await prisma.contact.create({
        data: { customerId: customer.id, firstName: `P${i}`, lastName: `L${i}`, email: `q${i}@acme.test` },
      });
    }

    const seen = await pageThrough(
      (page) =>
        contactService.findAll(user.id, { page: String(page), limit: '5' }) as Promise<{
          data: Array<{ id: string }>;
        }>,
      5
    );

    assertEveryRowOnce(seen, 25);
  });

  it('customers — every row exactly once', async () => {
    const user = await createUser();
    for (let i = 0; i < 25; i++) {
      await createCustomer(user.id, { name: 'Same Name', domain: `d${i}.test` });
    }

    const seen = await pageThrough(
      (page) =>
        customerService.findAll(user.id, {
          page: String(page),
          limit: '5',
          sortBy: 'name',
          sortOrder: 'asc',
        }) as Promise<{ data: Array<{ id: string }> }>,
      5
    );

    assertEveryRowOnce(seen, 25);
  });

  it('deals — every row exactly once', async () => {
    const user = await createUser();
    for (let i = 0; i < 25; i++) {
      await createDeal(user.id, { title: 'Same Title' });
    }

    const seen = await pageThrough(
      (page) =>
        dealService.findAll(user.id, {
          page: String(page),
          limit: '5',
          sortBy: 'title',
          sortOrder: 'asc',
        }) as Promise<{ data: Array<{ id: string }> }>,
      5
    );

    assertEveryRowOnce(seen, 25);
  });

  it('tasks — every row exactly once', async () => {
    const user = await createUser();
    for (let i = 0; i < 25; i++) {
      await createTask(user.id, { title: 'Same Title' });
    }

    const seen = await pageThrough(
      (page) =>
        taskService.findAll(user.id, {
          page: String(page),
          limit: '5',
          sortBy: 'title',
          sortOrder: 'asc',
        }) as Promise<{ data: Array<{ id: string }> }>,
      5
    );

    assertEveryRowOnce(seen, 25);
  });

  it('holds the order steady across two identical requests', async () => {
    const user = await createUser();
    const customer = await createCustomer(user.id);
    for (let i = 0; i < 20; i++) {
      await prisma.contact.create({
        data: { customerId: customer.id, firstName: `N${i}`, lastName: '', email: `r${i}@acme.test` },
      });
    }

    const params = { page: '1', limit: '10', sortBy: 'lastName', sortOrder: 'asc' };
    const first = await contactService.findAll(user.id, params);
    const second = await contactService.findAll(user.id, params);

    expect(first.data.map((c) => c.id)).toEqual(second.data.map((c) => c.id));
  });
});
