import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createUser, createEmail, createTwoUsers } from '../test/factories.js';
import { refileOwnDomainEmails } from './refileOwnDomainEmails.js';

/**
 * The repair moves live rows, so what needs pinning down is what it must NOT do:
 * misfile internal mail, touch another tenant, destroy colleague contacts, or
 * change anything on a dry run.
 */

async function ownCustomer(userId: string, domain: string) {
  return prisma.customer.create({
    data: { userId, domain, name: 'Powerm', company: 'Powerm' },
  });
}

describe('refileOwnDomainEmails', () => {
  it('moves sent mail onto the recipient company', async () => {
    const user = await createUser({ email: 'me@powerm.ma' });
    const own = await ownCustomer(user.id, 'powerm.ma');
    const email = await createEmail(user.id, { customerId: own.id, from: 'me@powerm.ma' });
    await prisma.email.update({
      where: { id: email.id },
      data: { to: ['buyer@intelcom.co.ma'] },
    });

    const summary = await refileOwnDomainEmails({ apply: true });

    expect(summary.refiled).toBe(1);
    const after = await prisma.email.findUnique({
      where: { id: email.id },
      include: { customer: { select: { domain: true } } },
    });
    expect(after?.customer?.domain).toBe('intelcom.co.ma');
  });

  it('unlinks internal mail rather than leaving it on your own company', async () => {
    const user = await createUser({ email: 'me@powerm.ma' });
    const own = await ownCustomer(user.id, 'powerm.ma');
    const email = await createEmail(user.id, { customerId: own.id, from: 'colleague@powerm.ma' });
    await prisma.email.update({ where: { id: email.id }, data: { to: ['me@powerm.ma'] } });

    const summary = await refileOwnDomainEmails({ apply: true });

    expect(summary.unlinked).toBe(1);
    const after = await prisma.email.findUnique({ where: { id: email.id } });
    expect(after?.customerId).toBeNull();
    // The message itself must survive.
    expect(after).not.toBeNull();
  });

  it('keeps the own-domain customer and its colleague contacts', async () => {
    const user = await createUser({ email: 'me@powerm.ma' });
    const own = await ownCustomer(user.id, 'powerm.ma');
    await prisma.contact.create({
      data: { customerId: own.id, firstName: 'A', lastName: 'B', email: 'colleague@powerm.ma' },
    });
    const email = await createEmail(user.id, { customerId: own.id, from: 'me@powerm.ma' });
    await prisma.email.update({ where: { id: email.id }, data: { to: ['x@lydec.co.ma'] } });

    await refileOwnDomainEmails({ apply: true });

    // Colleagues are worth knowing; the company just stops holding mail.
    expect(await prisma.customer.findUnique({ where: { id: own.id } })).not.toBeNull();
    expect(await prisma.contact.count({ where: { customerId: own.id } })).toBe(1);
    expect(await prisma.email.count({ where: { customerId: own.id } })).toBe(0);
  });

  it('writes nothing on a dry run', async () => {
    const user = await createUser({ email: 'me@powerm.ma' });
    const own = await ownCustomer(user.id, 'powerm.ma');
    const email = await createEmail(user.id, { customerId: own.id, from: 'me@powerm.ma' });
    await prisma.email.update({ where: { id: email.id }, data: { to: ['x@lydec.co.ma'] } });

    const summary = await refileOwnDomainEmails({ apply: false });

    expect(summary.refiled).toBe(1);
    const after = await prisma.email.findUnique({ where: { id: email.id } });
    expect(after?.customerId).toBe(own.id);
  });

  it('is safe to run twice', async () => {
    const user = await createUser({ email: 'me@powerm.ma' });
    const own = await ownCustomer(user.id, 'powerm.ma');
    const email = await createEmail(user.id, { customerId: own.id, from: 'me@powerm.ma' });
    await prisma.email.update({ where: { id: email.id }, data: { to: ['x@lydec.co.ma'] } });

    await refileOwnDomainEmails({ apply: true });
    const second = await refileOwnDomainEmails({ apply: true });

    expect(second.refiled).toBe(0);
    expect(second.unlinked).toBe(0);
  });

  it('does not touch another account', async () => {
    const { alice, bob } = await createTwoUsers();
    await prisma.user.update({ where: { id: alice.id }, data: { email: 'me@powerm.ma' } });
    await prisma.user.update({ where: { id: bob.id }, data: { email: 'other@acme.io' } });
    const aliceOwn = await ownCustomer(alice.id, 'powerm.ma');
    const bobOwn = await ownCustomer(bob.id, 'acme.io');
    const bobEmail = await createEmail(bob.id, { customerId: bobOwn.id, from: 'other@acme.io' });
    await prisma.email.update({ where: { id: bobEmail.id }, data: { to: ['x@lydec.co.ma'] } });

    await refileOwnDomainEmails({ apply: true });

    // Bob's own mail is re-filed under Bob's own new customer — never Alice's.
    const after = await prisma.email.findUnique({
      where: { id: bobEmail.id },
      include: { customer: { select: { userId: true, domain: true } } },
    });
    expect(after?.customer?.userId).toBe(bob.id);
    expect(after?.customer?.domain).toBe('lydec.co.ma');
    expect(await prisma.email.count({ where: { customerId: aliceOwn.id } })).toBe(0);
  });

  it('ignores a personal-mailbox account', async () => {
    const user = await createUser({ email: 'someone@gmail.com' });
    const customer = await prisma.customer.create({
      data: { userId: user.id, domain: 'gmail.com', name: 'Gmail' },
    });
    const email = await createEmail(user.id, { customerId: customer.id });

    const summary = await refileOwnDomainEmails({ apply: true });

    // A personal address is no one's company domain, so there is nothing to
    // re-file and the row is left exactly as it was.
    expect(summary.usersConsidered).toBe(0);
    expect((await prisma.email.findUnique({ where: { id: email.id } }))?.customerId).toBe(customer.id);
  });
});
