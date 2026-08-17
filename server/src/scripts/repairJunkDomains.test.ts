import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createUser, createEmail, createDeal } from '../test/factories.js';
import { repairJunkDomains } from './repairJunkDomains.js';

/**
 * The repair rewrites live rows, so the properties worth pinning down are the
 * destructive ones: it must not merge two companies, must not delete a customer
 * that still holds anything, must not touch another tenant, and must be safe to
 * run twice.
 */

async function junkCustomer(userId: string, domain: string, name: string) {
  return prisma.customer.create({
    data: { userId, domain, name, company: name, website: `https://${domain}` },
  });
}

async function emailFrom(userId: string, customerId: string, from: string) {
  return createEmail(userId, { customerId, from });
}

describe('repairJunkDomains', () => {
  it('splits one junk customer back into the real companies behind it', async () => {
    const user = await createUser();
    const junk = await junkCustomer(user.id, 'co.ma', 'CO');
    await emailFrom(user.id, junk.id, 'contact@intelcom.co.ma');
    await emailFrom(user.id, junk.id, 'contact@lydec.co.ma');
    await emailFrom(user.id, junk.id, 'someone@deloitte.co.ma');

    const summary = await repairJunkDomains({ apply: true });

    expect(summary.junkCustomers).toBe(1);
    expect(summary.emailsRelinked).toBe(3);
    expect(summary.junkCustomersDeleted).toBe(1);

    // The whole point: three companies, not one.
    const customers = await prisma.customer.findMany({
      where: { userId: user.id },
      select: { domain: true, name: true },
      orderBy: { domain: 'asc' },
    });
    expect(customers).toEqual([
      { domain: 'deloitte.co.ma', name: 'Deloitte' },
      { domain: 'intelcom.co.ma', name: 'Intelcom' },
      { domain: 'lydec.co.ma', name: 'Lydec' },
    ]);
    expect(await prisma.customer.count({ where: { domain: 'co.ma' } })).toBe(0);
  });

  it('moves the contacts with their mail', async () => {
    const user = await createUser();
    const junk = await junkCustomer(user.id, 'co.ma', 'CO');
    await prisma.contact.create({
      data: { customerId: junk.id, firstName: 'A', lastName: 'B', email: 'a.b@intelcom.co.ma' },
    });
    await prisma.contact.create({
      data: { customerId: junk.id, firstName: 'C', lastName: 'D', email: 'c.d@lydec.co.ma' },
    });

    const summary = await repairJunkDomains({ apply: true });
    expect(summary.contactsRelinked).toBe(2);

    const intelcom = await prisma.customer.findFirst({
      where: { userId: user.id, domain: 'intelcom.co.ma' },
      include: { contacts: { select: { email: true } } },
    });
    expect(intelcom?.contacts).toEqual([{ email: 'a.b@intelcom.co.ma' }]);
  });

  it('unlinks mail that belongs to no company rather than misfiling it', async () => {
    const user = await createUser();
    const junk = await junkCustomer(user.id, 'co.ma', 'CO');
    // A personal address gives no company at all.
    const email = await emailFrom(user.id, junk.id, 'someone@gmail.com');

    const summary = await repairJunkDomains({ apply: true });
    expect(summary.emailsUnlinked).toBe(1);
    expect(summary.emailsRelinked).toBe(0);

    const after = await prisma.email.findUnique({ where: { id: email.id } });
    expect(after?.customerId).toBeNull();
    // The message itself must survive.
    expect(after).not.toBeNull();
  });

  it('refuses to delete a junk customer that still holds a deal', async () => {
    const user = await createUser();
    const junk = await junkCustomer(user.id, 'co.ma', 'CO');
    const deal = await createDeal(user.id, { title: 'Important deal' });
    await prisma.deal.update({ where: { id: deal.id }, data: { customerId: junk.id } });

    const summary = await repairJunkDomains({ apply: true });

    expect(summary.junkCustomersDeleted).toBe(0);
    expect(summary.skipped).toEqual([{ domain: 'co.ma', reason: 'still holds 1 deals' }]);
    // Deleting the customer would have cascaded the deal away.
    expect(await prisma.deal.count({ where: { customerId: junk.id } })).toBe(1);
    expect(await prisma.customer.findUnique({ where: { id: junk.id } })).not.toBeNull();
  });

  it('does not touch another user data', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const aliceJunk = await junkCustomer(alice.id, 'co.ma', 'CO');
    const bobJunk = await junkCustomer(bob.id, 'co.ma', 'CO');
    await emailFrom(alice.id, aliceJunk.id, 'x@intelcom.co.ma');
    await emailFrom(bob.id, bobJunk.id, 'y@lydec.co.ma');

    await repairJunkDomains({ apply: true });

    // Each user gets their own corrected customer — never a shared one.
    const aliceCustomers = await prisma.customer.findMany({ where: { userId: alice.id } });
    const bobCustomers = await prisma.customer.findMany({ where: { userId: bob.id } });
    expect(aliceCustomers.map((c) => c.domain)).toEqual(['intelcom.co.ma']);
    expect(bobCustomers.map((c) => c.domain)).toEqual(['lydec.co.ma']);
    expect(aliceCustomers[0].id).not.toBe(bobCustomers[0].id);
  });

  it('writes nothing on a dry run', async () => {
    const user = await createUser();
    const junk = await junkCustomer(user.id, 'co.ma', 'CO');
    await emailFrom(user.id, junk.id, 'contact@intelcom.co.ma');

    const summary = await repairJunkDomains({ apply: false });

    expect(summary.junkCustomers).toBe(1);
    expect(summary.emailsRelinked).toBe(1);
    expect(summary.junkCustomersDeleted).toBe(0);
    // Nothing actually moved.
    const customers = await prisma.customer.findMany({ where: { userId: user.id } });
    expect(customers.map((c) => c.domain)).toEqual(['co.ma']);
  });

  it('is safe to run twice', async () => {
    const user = await createUser();
    const junk = await junkCustomer(user.id, 'co.ma', 'CO');
    await emailFrom(user.id, junk.id, 'contact@intelcom.co.ma');

    await repairJunkDomains({ apply: true });
    const second = await repairJunkDomains({ apply: true });

    expect(second.junkCustomers).toBe(0);
    expect(second.emailsRelinked).toBe(0);
    expect(await prisma.customer.count({ where: { userId: user.id } })).toBe(1);
  });

  it('keeps a subdomain under its real company', async () => {
    const user = await createUser();
    const junk = await junkCustomer(user.id, 'co.ma', 'CO');
    await emailFrom(user.id, junk.id, 'noreply@info.lydec.co.ma');

    await repairJunkDomains({ apply: true });

    const customers = await prisma.customer.findMany({ where: { userId: user.id } });
    expect(customers.map((c) => c.domain)).toEqual(['lydec.co.ma']);
  });
});
