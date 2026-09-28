import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { promoteSenders } from './accountStatus.js';
import { customerService } from './customerService.js';
import { taskService } from './taskService.js';
import { createTwoUsers, createCustomer, createContact, createTask, createRfp, seedTaskStatuses } from '../test/factories.js';

/**
 * Accounts and senders. Every domain that mails the user becomes a company,
 * and 3,046 of them buried the forty that mattered. A company is an account
 * once there is a relationship; the rest are senders to keep or ignore.
 */
const statusOf = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).status;

describe('promoteSenders', () => {
  it('promotes a sender for each kind of relationship', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const vip = await createCustomer(alice.id);
    await prisma.customer.update({ where: { id: vip.id }, data: { isVip: true } });
    const internal = await createCustomer(alice.id);
    await prisma.customer.update({ where: { id: internal.id }, data: { isInternal: true } });
    const categorised = await createCustomer(alice.id);
    const category = await prisma.companyCategory.create({ data: { userId: alice.id, name: 'CLIENT', label: 'Client', color: '#000000' } });
    await prisma.customer.update({ where: { id: categorised.id }, data: { categoryId: category.id } });
    const withTask = await createCustomer(alice.id);
    const t = await createTask(alice.id, { title: 'x' });
    await prisma.task.update({ where: { id: t.id }, data: { customerId: withTask.id } });
    const withRfp = await createCustomer(alice.id);
    const r = await createRfp(alice.id, {});
    await prisma.rfp.update({ where: { id: r.id }, data: { customerId: withRfp.id } });
    const met = await createCustomer(alice.id);
    const ev = await prisma.calendarEvent.create({ data: { userId: alice.id, title: 'M', startTime: new Date(), endTime: new Date() } });
    await prisma.calendarEventCustomer.create({ data: { calendarEventId: ev.id, customerId: met.id } });
    const writtenTo = await createCustomer(alice.id);
    const c = await createContact(writtenTo.id);
    await prisma.contact.update({ where: { id: c.id }, data: { engagement: 'both' } });

    const promoted = await promoteSenders(alice.id);

    expect(promoted).toBe(7);
    for (const co of [vip, internal, categorised, withTask, withRfp, met, writtenTo]) expect(await statusOf(co.id)).toBe('ACCOUNT');
  });

  it('leaves a company that has only mailed the user as a sender', async () => {
    const { alice } = await createTwoUsers();
    const newsletter = await createCustomer(alice.id);
    const c = await createContact(newsletter.id);
    await prisma.contact.update({ where: { id: c.id }, data: { engagement: 'sender' } });

    await promoteSenders(alice.id);

    expect(await statusOf(newsletter.id)).toBe('SENDER');
  });

  it("never promotes an ignored sender, or another user's company", async () => {
    const { alice, bob } = await createTwoUsers();
    const ignored = await createCustomer(alice.id);
    await prisma.customer.update({ where: { id: ignored.id }, data: { status: 'IGNORED', isVip: true } });
    const bobs = await createCustomer(bob.id);
    await prisma.customer.update({ where: { id: bobs.id }, data: { isVip: true } });

    await promoteSenders(alice.id);

    expect(await statusOf(ignored.id)).toBe('IGNORED');
    expect(await statusOf(bobs.id)).toBe('SENDER');
  });

  it('can be limited to given companies', async () => {
    const { alice } = await createTwoUsers();
    const a = await createCustomer(alice.id);
    const b = await createCustomer(alice.id);
    await prisma.customer.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { isVip: true } });

    await promoteSenders(alice.id, [a.id]);

    expect(await statusOf(a.id)).toBe('ACCOUNT');
    expect(await statusOf(b.id)).toBe('SENDER');
  });
});

describe('company status in the services', () => {
  it('makes a company created by hand an account, and one found from mail a sender', async () => {
    const { alice } = await createTwoUsers();
    const byHand = await customerService.create(alice.id, { name: 'Attijariwafa', domain: 'attijariwafa.com' });
    const fromMail = await customerService.findOrCreateByDomain(alice.id, 'newsletter.example');
    expect(byHand.status).toBe('ACCOUNT');
    expect(fromMail.customer.status).toBe('SENDER');
  });

  it('makes a sender an account when it is marked VIP or given a category', async () => {
    const { alice } = await createTwoUsers();
    const a = await createCustomer(alice.id);
    const b = await createCustomer(alice.id);
    const category = await prisma.companyCategory.create({ data: { userId: alice.id, name: 'CLIENT', label: 'Client', color: '#000000' } });

    expect((await customerService.update(alice.id, a.id, { isVip: true })).status).toBe('ACCOUNT');
    expect((await customerService.update(alice.id, b.id, { categoryId: category.id })).status).toBe('ACCOUNT');
  });

  it('promotes the company a new task is for', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const co = await createCustomer(alice.id);

    await taskService.create(alice.id, { title: 'Relancer', customerId: co.id } as never);

    expect(await statusOf(co.id)).toBe('ACCOUNT');
  });

  it("filters, counts and triages by status, on the caller's own companies only", async () => {
    const { alice, bob } = await createTwoUsers();
    const account = await customerService.create(alice.id, { name: 'Acct', domain: 'acct.example' });
    const s1 = await createCustomer(alice.id);
    const s2 = await createCustomer(alice.id);
    const bobs = await createCustomer(bob.id);

    expect((await customerService.findAll(alice.id, { status: 'ACCOUNT' })).data.map((c) => c.id)).toEqual([account.id]);
    expect(await customerService.statusCounts(alice.id)).toEqual({ ACCOUNT: 1, SENDER: 2, IGNORED: 0 });

    const res = await customerService.setStatus(alice.id, [s1.id, bobs.id], 'IGNORED');

    expect(res.updated).toBe(1);
    expect(await statusOf(s1.id)).toBe('IGNORED');
    expect(await statusOf(bobs.id)).toBe('SENDER');
    expect(await statusOf(s2.id)).toBe('SENDER');
  });
});
