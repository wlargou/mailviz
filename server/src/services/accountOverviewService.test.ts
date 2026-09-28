import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createCustomer, createContact, createEmail, createTask, createRfp, createDeal, seedTaskStatuses } from '../test/factories.js';
import { accountOverviewService } from './accountOverviewService.js';

/**
 * The account overview and its timeline. Pinned: the last touch is the later
 * of mail and meetings, the weekly rhythm lands in the right weeks, only open
 * work counts as open, people rank by exchanges, another user's account is a
 * 404, and the timeline pages without dropping or repeating an entry.
 */

const NOW = new Date('2026-09-28T09:00:00Z'); // a Monday
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

async function meeting(userId: string, customerId: string, at: Date, title = 'Meeting') {
  const ev = await prisma.calendarEvent.create({ data: { userId, title, startTime: at, endTime: at } });
  await prisma.calendarEventCustomer.create({ data: { calendarEventId: ev.id, customerId } });
  return ev;
}

describe('accountOverviewService.overview', () => {
  it('takes the last touch from mail or meetings, whichever is later', async () => {
    const { alice } = await createTwoUsers();
    const acme = await createCustomer(alice.id);
    await createEmail(alice.id, { customerId: acme.id, receivedAt: days(-10) });
    await meeting(alice.id, acme.id, days(-3));
    // Future meetings are not a touch yet.
    await meeting(alice.id, acme.id, days(2));

    const o = await accountOverviewService.overview(alice.id, acme.id, NOW);
    expect(o.lastTouchAt).toEqual(days(-3));
  });

  it('counts mail and meetings per week, oldest week first, twelve of them', async () => {
    const { alice } = await createTwoUsers();
    const acme = await createCustomer(alice.id);
    await createEmail(alice.id, { customerId: acme.id, receivedAt: days(0) });
    await createEmail(alice.id, { customerId: acme.id, receivedAt: days(-1) }); // Sunday: last week
    await createEmail(alice.id, { customerId: acme.id, receivedAt: days(-7) });
    await meeting(alice.id, acme.id, days(-6));

    const { weekly } = await accountOverviewService.overview(alice.id, acme.id, NOW);
    expect(weekly).toHaveLength(12);
    expect(weekly[11]).toMatchObject({ weekStart: new Date('2026-09-28T00:00:00Z'), emails: 1, meetings: 0 });
    expect(weekly[10]).toMatchObject({ weekStart: new Date('2026-09-21T00:00:00Z'), emails: 2, meetings: 1 });
    expect(weekly.slice(0, 10).every((w) => w.emails === 0 && w.meetings === 0)).toBe(true);
  });

  it('lists only open work, and people by how much you exchange', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const acme = await createCustomer(alice.id);
    await createTask(alice.id, { title: 'Open', customerId: acme.id });
    await createTask(alice.id, { title: 'Done', customerId: acme.id, status: 'DONE' });
    const live = await createRfp(alice.id, { name: 'Live tender' });
    const won = await createRfp(alice.id, { name: 'Won tender', status: 'WON' });
    await prisma.rfp.updateMany({ where: { id: { in: [live.id, won.id] } }, data: { customerId: acme.id } });
    const deal = await createDeal(alice.id, { title: 'Registration' });
    const declined = await createDeal(alice.id, { title: 'Declined', status: 'DECLINED' });
    await prisma.deal.updateMany({ where: { id: { in: [deal.id, declined.id] } }, data: { customerId: acme.id } });

    await createContact(acme.id, { firstName: 'Quiet', lastName: 'One', email: 'quiet@acme.test' });
    await createContact(acme.id, { firstName: 'Busy', lastName: 'One', email: 'busy@acme.test' });
    for (let i = 0; i < 3; i++) await createEmail(alice.id, { customerId: acme.id, from: 'busy@acme.test' });
    const sent = await createEmail(alice.id, { customerId: acme.id, from: alice.email });
    await prisma.email.update({ where: { id: sent.id }, data: { to: ['Quiet One <quiet@acme.test>'] } });

    const o = await accountOverviewService.overview(alice.id, acme.id, new Date());

    expect(o.open.tasks.map((t) => t.title)).toEqual(['Open']);
    expect(o.open.taskCount).toBe(1);
    expect(o.open.tenders.map((t) => t.name)).toEqual(['Live tender']);
    expect(o.open.deals.map((d) => d.title)).toEqual(['Registration']);
    expect(o.keyPeople.map((p) => [p.name, p.exchanges])).toEqual([['Busy One', 3], ['Quiet One', 1]]);
  });

  it("is a 404 on another user's company", async () => {
    const { alice, bob } = await createTwoUsers();
    const bobs = await createCustomer(bob.id);
    await expect(accountOverviewService.overview(alice.id, bobs.id, NOW)).rejects.toMatchObject({ statusCode: 404, code: 'CUSTOMER_NOT_FOUND' });
    await expect(accountOverviewService.timeline(alice.id, bobs.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('accountOverviewService.timeline', () => {
  it('interleaves threads, meetings and work, newest first, a thread once', async () => {
    const { alice } = await createTwoUsers();
    const acme = await createCustomer(alice.id);
    await createEmail(alice.id, { customerId: acme.id, threadId: 'th', subject: 'Offer', receivedAt: days(-5) });
    await createEmail(alice.id, { customerId: acme.id, threadId: 'th', subject: 'Re: Offer', receivedAt: days(-2) });
    await meeting(alice.id, acme.id, days(-3), 'Kickoff');
    const task = await createTask(alice.id, { title: 'Follow up', customerId: acme.id });
    await prisma.task.update({ where: { id: task.id }, data: { createdAt: days(-1) } });

    const { entries, nextBefore } = await accountOverviewService.timeline(alice.id, acme.id, NOW.toISOString());

    expect(entries.map((e) => [e.kind, e.title])).toEqual([
      ['TASK', 'Follow up'],
      ['THREAD', 'Re: Offer'],
      ['MEETING', 'Kickoff'],
    ]);
    expect(entries[1].threadId).toBe('th');
    expect(nextBefore).toBeNull();
  });

  it('pages without losing or repeating an entry', async () => {
    const { alice } = await createTwoUsers();
    const acme = await createCustomer(alice.id);
    for (let i = 0; i < 40; i++) {
      await createEmail(alice.id, { customerId: acme.id, threadId: `t${i}`, receivedAt: days(-i - 1) });
    }
    for (let i = 0; i < 5; i++) await meeting(alice.id, acme.id, new Date(days(-i * 8 - 1).getTime() - 3_600_000));

    const first = await accountOverviewService.timeline(alice.id, acme.id, NOW.toISOString());
    expect(first.entries).toHaveLength(30);
    const second = await accountOverviewService.timeline(alice.id, acme.id, first.nextBefore!.toISOString());
    const all = [...first.entries, ...second.entries];

    expect(new Set(all.map((e) => `${e.kind}:${e.id}`)).size).toBe(45);
    expect(all.map((e) => e.at.getTime())).toEqual([...all].map((e) => e.at.getTime()).sort((a, b) => b - a));
  });
});
