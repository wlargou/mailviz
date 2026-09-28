import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import {
  createTwoUsers, createCustomer, createRfp, createDeal, createTask, createEmail, seedTaskStatuses,
} from '../test/factories.js';
import { pursuitsClosing, waitingOnOthers, quietAccounts, todayService } from './todayService.js';

/**
 * Today's parts, each against the database: which tenders and deals count as
 * closing, which sent mail counts as waiting, which accounts count as quiet,
 * and what the next meeting brings with it. Each is a rule a list is built
 * on, so each is pinned on both sides of its line.
 */

const NOW = new Date('2026-09-28T09:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

describe('pursuitsClosing', () => {
  it('lists live tenders and deal registrations closing within two weeks, soonest first', async () => {
    const { alice, bob } = await createTwoUsers();
    const soon = await createRfp(alice.id, { name: 'Soon', deadlineAt: days(2), status: 'WORKING' });
    await createRfp(alice.id, { name: 'Far', deadlineAt: days(30) });
    await createRfp(alice.id, { name: 'Submitted', deadlineAt: days(3), status: 'SUBMITTED' });
    await createRfp(alice.id, { name: 'Won', deadlineAt: days(3), status: 'WON' });
    const late = await createRfp(alice.id, { name: 'Late', deadlineAt: days(-1) });
    // Bob's: only if shared.
    await createRfp(bob.id, { name: 'Bob private', deadlineAt: days(1) });
    const shared = await createRfp(bob.id, { name: 'Bob shared', deadlineAt: days(5) });
    await prisma.rfpShare.create({ data: { rfpId: shared.id, sharedByUserId: bob.id, sharedWithUserId: alice.id } });

    const deal = await createDeal(alice.id, { title: 'Renewal' });
    await prisma.deal.update({ where: { id: deal.id }, data: { expiryDate: days(4) } });
    const declined = await createDeal(alice.id, { title: 'Declined', status: 'DECLINED' });
    await prisma.deal.update({ where: { id: declined.id }, data: { expiryDate: days(4) } });

    const list = await pursuitsClosing(alice.id, NOW);

    expect(list.map((p) => p.title)).toEqual(['Late', 'Soon', 'Renewal', 'Bob shared']);
    expect(list.find((p) => p.id === soon.id)).toMatchObject({ kind: 'RFP', href: `/rfps/${soon.id}`, readiness: { ready: 0, total: 0 } });
    expect(list.find((p) => p.id === late.id)).toMatchObject({ kind: 'RFP' });
    expect(list.find((p) => p.title === 'Renewal')).toMatchObject({ kind: 'DEAL', readiness: null, atRisk: false });
  });

  it('flags a tender behind on its pieces as at risk', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await createRfp(alice.id, { deadlineAt: days(2) });
    // Registered three weeks ago: nearly all the time is used, and nothing is ready.
    await prisma.rfp.update({ where: { id: rfp.id }, data: { createdAt: days(-21) } });
    const folder = await prisma.rfpFolder.create({ data: { rfpId: rfp.id, title: 'Administratif', kind: 'ADMINISTRATIF', position: 0 } });
    await prisma.rfpFolderItem.create({ data: { folderId: folder.id, title: 'Caution', position: 0 } });

    const [p] = await pursuitsClosing(alice.id, NOW);
    expect(p).toMatchObject({ atRisk: true, readiness: { ready: 0, total: 1 } });
  });
});

describe('waitingOnOthers', () => {
  it('lists threads I wrote last, to a person, over two days ago, oldest first', async () => {
    const { alice } = await createTwoUsers();
    const me = alice.email;
    const sent = (thread: string, to: string[], at: Date, subject = thread) =>
      createEmail(alice.id, { threadId: thread, from: me, receivedAt: at, subject, labelIds: ['SENT'] })
        .then((e) => prisma.email.update({ where: { id: e.id }, data: { to } }));

    await sent('quote', ['Omar <omar@bkam.ma>'], days(-3));
    await sent('older', ['salma@dgi.gov.ma'], days(-5));
    await sent('fresh', ['omar@bkam.ma'], hours(-20));
    await sent('to-desk', ['support@vendor.io'], days(-3));
    await sent('invite', ['omar@bkam.ma'], days(-3), 'Invitation: Comité @ Mon');
    // Answered: their reply is the latest message in the thread.
    await sent('answered', ['karim@client.ma'], days(-4));
    // Addressed to me, from a person: only "the last word is not mine" keeps it off.
    await createEmail(alice.id, { threadId: 'answered', from: 'karim@client.ma', receivedAt: days(-2) })
      .then((e) => prisma.email.update({ where: { id: e.id }, data: { to: [me, 'omar@bkam.ma'] } }));

    const waiting = await waitingOnOthers(alice.id, NOW);

    expect(waiting.map((w) => w.threadId)).toEqual(['older', 'quote']);
    expect(waiting[1].to).toBe('Omar <omar@bkam.ma>');
  });
});

describe('quietAccounts', () => {
  it('lists accounts with open work and no exchange in three weeks', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const account = async (name: string, over: { status?: string; isInternal?: boolean } = {}) => {
      const c = await createCustomer(alice.id, { name });
      return prisma.customer.update({ where: { id: c.id }, data: { status: over.status ?? 'ACCOUNT', isInternal: over.isInternal ?? false } });
    };

    const silent = await account('Silent');
    await createTask(alice.id, { customerId: silent.id });
    await createEmail(alice.id, { customerId: silent.id, receivedAt: days(-30) });

    const talking = await account('Talking');
    await createTask(alice.id, { customerId: talking.id });
    await createEmail(alice.id, { customerId: talking.id, receivedAt: days(-5) });

    const met = await account('Met');
    await createTask(alice.id, { customerId: met.id });
    const ev = await prisma.calendarEvent.create({ data: { userId: alice.id, title: 'Review', startTime: days(-3), endTime: days(-3) } });
    await prisma.calendarEventCustomer.create({ data: { calendarEventId: ev.id, customerId: met.id } });

    const never = await account('Never');
    await createRfp(alice.id, { name: 'Their tender' }).then((r) => prisma.rfp.update({ where: { id: r.id }, data: { customerId: never.id } }));

    const idle = await account('Idle, nothing open');
    await createEmail(alice.id, { customerId: idle.id, receivedAt: days(-60) });
    const doneOnly = await account('Done only');
    await createTask(alice.id, { customerId: doneOnly.id, status: 'DONE' });
    const sender = await account('A sender', { status: 'SENDER' });
    await createTask(alice.id, { customerId: sender.id });
    const office = await account('Own office', { isInternal: true });
    await createTask(alice.id, { customerId: office.id });

    const quiet = await quietAccounts(alice.id, NOW);

    // Never touched sorts first, then the longest silence.
    expect(quiet.map((q) => q.name)).toEqual(['Never', 'Silent']);
    expect(quiet[1]).toMatchObject({ openWork: 1 });
  });
});

describe('todayService.forUser', () => {
  it('brings the next meeting with its people, their last threads and their company’s open work', async () => {
    const { alice } = await createTwoUsers();
    await prisma.user.update({ where: { id: alice.id }, data: { timezone: 'UTC' } });
    await seedTaskStatuses(alice.id);
    const now = new Date();
    const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
    const bkam = await createCustomer(alice.id, { name: 'BKAM' });

    const attendees = [
      { email: alice.email, self: true },
      { email: 'omar@bkam.ma', displayName: 'Omar', responseStatus: 'accepted' },
    ];
    // Already over; then the next; then a later one.
    await prisma.calendarEvent.create({ data: { userId: alice.id, title: 'Earlier', startTime: at(-3), endTime: at(-2) } });
    const next = await prisma.calendarEvent.create({
      data: { userId: alice.id, title: 'Comité', startTime: at(0.5), endTime: at(1), attendees },
    });
    await prisma.calendarEventCustomer.create({ data: { calendarEventId: next.id, customerId: bkam.id } });

    await createEmail(alice.id, { threadId: 'th-1', from: 'omar@bkam.ma', subject: 'Planning', receivedAt: at(-30) });
    await createEmail(alice.id, { threadId: 'th-1', from: 'omar@bkam.ma', subject: 'Planning', receivedAt: at(-20) });
    await createEmail(alice.id, { threadId: 'th-2', from: 'someone@else.ma', subject: 'Unrelated', receivedAt: at(-10) });
    // A ticket desk copying the attendee, and an invitation: not conversations.
    await createEmail(alice.id, { threadId: 'th-desk', from: 'support@desk.io', subject: 'New ticket has been created', receivedAt: at(-5) })
      .then((e) => prisma.email.update({ where: { id: e.id }, data: { to: ['omar@bkam.ma'] } }));
    await createEmail(alice.id, { threadId: 'th-invite', from: 'omar@bkam.ma', subject: 'Invitation: Comité @ Mon', receivedAt: at(-4) });
    await createTask(alice.id, { title: 'Send the planning', customerId: bkam.id });
    await createTask(alice.id, { title: 'Closed already', customerId: bkam.id, status: 'DONE' });

    const today = await todayService.forUser(alice.id, now);

    expect(today.nextUp?.event.title).toBe('Comité');
    expect(today.nextUp?.event.companies).toEqual([{ id: bkam.id, name: 'BKAM' }]);
    expect(today.nextUp?.prep.people).toEqual([{ email: 'omar@bkam.ma', name: 'Omar', responseStatus: 'accepted' }]);
    // One row per thread, not per message.
    expect(today.nextUp?.prep.recentThreads.map((t) => t.threadId)).toEqual(['th-1']);
    expect(today.nextUp?.prep.openTasks.map((t) => t.title)).toEqual(['Send the planning']);
  });

  it('counts what was finished today in the wrap-up, and nothing still open', async () => {
    const { alice } = await createTwoUsers();
    await prisma.user.update({ where: { id: alice.id }, data: { timezone: 'UTC' } });
    await seedTaskStatuses(alice.id);
    await createTask(alice.id, { title: 'Shipped', status: 'DONE' });
    await createTask(alice.id, { title: 'Still open' });
    const old = await createTask(alice.id, { title: 'Done last week', status: 'DONE' });
    await prisma.$executeRaw`UPDATE tasks SET updated_at = NOW() - INTERVAL '7 days' WHERE id = ${old.id}`;

    const today = await todayService.forUser(alice.id);

    expect(today.wrapUp.finished.map((t) => t.title)).toEqual(['Shipped']);
  });
});
