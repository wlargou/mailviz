import { describe, it, expect } from 'vitest';
import { taskService } from './taskService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createTask, createCustomer, createContact, createDeal, shareTaskWith } from '../test/factories.js';

/**
 * Links from a task to a contact, a deal or an event.
 *
 * The column is polymorphic, so nothing in the database checks the target.
 * The service does — on write the target must belong to the task's account,
 * and on read a link whose target is gone or foreign is dropped rather than
 * resolved. These run against a real Postgres.
 */
async function createEvent(userId: string, title = 'Kickoff') {
  return prisma.calendarEvent.create({
    data: { userId, title, startTime: new Date('2026-09-10T09:00:00.000Z'), endTime: new Date('2026-09-10T10:00:00.000Z') },
  });
}

describe('taskService — links', () => {
  it('links a contact, a deal and an event, resolving each for display', async () => {
    const { alice } = await createTwoUsers();
    const acme = await createCustomer(alice.id, { name: 'Acme' });
    const sam = await createContact(acme.id, { firstName: 'Sam', lastName: 'Lee' });
    const deal = await createDeal(alice.id, { title: 'Acme renewal' });
    const event = await createEvent(alice.id);
    const task = await createTask(alice.id);

    await taskService.addLink(alice.id, task.id, { entityType: 'contact', entityId: sam.id });
    await taskService.addLink(alice.id, task.id, { entityType: 'deal', entityId: deal.id });
    const linked = await taskService.addLink(alice.id, task.id, { entityType: 'event', entityId: event.id });

    expect(linked.links.map((l: { entityType: string; label: string; subtitle: string | null }) => [l.entityType, l.label, l.subtitle])).toEqual([
      ['contact', 'Sam Lee', 'Acme'],
      ['deal', 'Acme renewal', expect.any(String)],
      ['event', 'Kickoff', null],
    ]);
    expect(linked.links[2].when).toEqual(new Date('2026-09-10T09:00:00.000Z'));
    expect(linked).toMatchObject({ linkCount: 3 });

    // Twice is one row.
    await taskService.addLink(alice.id, task.id, { entityType: 'deal', entityId: deal.id });
    expect(await prisma.taskLink.count({ where: { taskId: task.id } })).toBe(3);

    const unlinked = await taskService.removeLink(alice.id, task.id, 'deal', deal.id);
    expect(unlinked.links.map((l: { entityType: string }) => l.entityType)).toEqual(['contact', 'event']);
    await expect(taskService.removeLink(alice.id, task.id, 'deal', deal.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a target owned by another account, through the customer for contacts — REGRESSION guard', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createTask(alice.id);
    const bobsCustomer = await createCustomer(bob.id, { name: 'BobsSecretCo' });
    const bobsContact = await createContact(bobsCustomer.id, { firstName: 'Secret', lastName: 'Person' });
    const bobsDeal = await createDeal(bob.id, { title: 'BobsSecretDeal' });
    const bobsEvent = await createEvent(bob.id, 'BobsSecretEvent');

    for (const [entityType, entityId] of [
      ['contact', bobsContact.id],
      ['deal', bobsDeal.id],
      ['event', bobsEvent.id],
    ] as const) {
      await expect(taskService.addLink(alice.id, mine.id, { entityType, entityId })).rejects.toMatchObject({ statusCode: 404 });
    }
    expect(await prisma.taskLink.count()).toBe(0);
  });

  it('a link whose target was deleted, or belongs to someone else, is dropped on read', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(alice.id);
    const deal = await createDeal(alice.id, { title: 'Gone soon' });
    await taskService.addLink(alice.id, task.id, { entityType: 'deal', entityId: deal.id });
    // Written raw, bypassing the service, as a leak would be.
    const bobsDeal = await createDeal(bob.id, { title: 'BobsSecretDeal' });
    await prisma.taskLink.create({ data: { taskId: task.id, entityType: 'deal', entityId: bobsDeal.id } });

    await prisma.deal.delete({ where: { id: deal.id } });

    const detail = await taskService.findById(alice.id, task.id);
    expect(detail.links).toEqual([]);
    expect(JSON.stringify(detail)).not.toContain('BobsSecretDeal');
  });

  it('a share recipient may link the owner\'s records, not their own', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createTask(alice.id);
    await shareTaskWith(shared.id, alice.id, bob.id);
    const alicesDeal = await createDeal(alice.id, { title: 'Alice deal' });
    const bobsDeal = await createDeal(bob.id, { title: 'Bob deal' });

    const ok = await taskService.addLink(bob.id, shared.id, { entityType: 'deal', entityId: alicesDeal.id });
    expect(ok.links.map((l: { label: string }) => l.label)).toEqual(['Alice deal']);
    await expect(taskService.addLink(bob.id, shared.id, { entityType: 'deal', entityId: bobsDeal.id })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('findAll can narrow to the tasks linked to one record, and a malformed filter matches nothing', async () => {
    const { alice } = await createTwoUsers();
    const deal = await createDeal(alice.id);
    const linked = await createTask(alice.id, { title: 'linked' });
    await createTask(alice.id, { title: 'not linked' });
    await taskService.addLink(alice.id, linked.id, { entityType: 'deal', entityId: deal.id });

    const forDeal = await taskService.findAll(alice.id, { linkedTo: `deal:${deal.id}` });
    expect(forDeal.data.map((t) => t.title)).toEqual(['linked']);
    expect(forDeal.data[0]).toMatchObject({ linkCount: 1 });

    expect((await taskService.findAll(alice.id, { linkedTo: 'garbage' })).data).toEqual([]);
    expect((await taskService.findAll(alice.id, { linkedTo: `customer:${deal.id}` })).data).toEqual([]);
  });

  it('links go with the task', async () => {
    const { alice } = await createTwoUsers();
    const deal = await createDeal(alice.id);
    const task = await createTask(alice.id);
    await taskService.addLink(alice.id, task.id, { entityType: 'deal', entityId: deal.id });

    await taskService.delete(alice.id, task.id);

    expect(await prisma.taskLink.count()).toBe(0);
  });
});
