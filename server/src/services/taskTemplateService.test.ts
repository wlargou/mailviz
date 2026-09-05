import { describe, it, expect } from 'vitest';
import { taskTemplateService } from './taskTemplateService.js';
import { taskService } from './taskService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createTask, createCustomer, createDeal, seedTaskStatuses, shareTaskWith } from '../test/factories.js';

/**
 * Task templates: a saved tree, applied against an anchor day.
 *
 * What matters: the offsets land on the right days, subtasks and checklists
 * come out as real rows, labels are the account's own, and applying is all
 * or nothing. These run against a real Postgres.
 */
const DAY = 86_400_000;

describe('taskTemplateService', () => {
  it('creates, lists, renames and deletes, with names unique per account', async () => {
    const { alice, bob } = await createTwoUsers();
    const t = await taskTemplateService.create(alice.id, { name: 'Onboarding', items: [{ title: 'Kickoff' }, { title: 'Follow up', subtasks: [{ title: 'Send notes' }] }] });
    expect(t.taskCount).toBe(3);

    await expect(taskTemplateService.create(alice.id, { name: 'Onboarding', items: [{ title: 'x' }] })).rejects.toMatchObject({ statusCode: 409 });
    // Same name in another account is fine.
    await taskTemplateService.create(bob.id, { name: 'Onboarding', items: [{ title: 'x' }] });

    expect((await taskTemplateService.findAll(alice.id)).map((x) => x.name)).toEqual(['Onboarding']);
    await expect(taskTemplateService.findById(bob.id, t.id)).rejects.toMatchObject({ statusCode: 404 });

    const renamed = await taskTemplateService.update(alice.id, t.id, { name: 'Partner onboarding' });
    expect(renamed.name).toBe('Partner onboarding');
    await taskTemplateService.delete(alice.id, t.id);
    expect(await prisma.taskTemplate.count({ where: { userId: alice.id } })).toBe(0);
  });

  it('refuses labels the account does not own — REGRESSION guard', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobsLabel = await prisma.label.create({ data: { userId: bob.id, name: 'BobsLabel', color: '#000000' } });
    await expect(
      taskTemplateService.create(alice.id, { name: 'x', items: [{ title: 'x', labelIds: [bobsLabel.id] }] })
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      taskTemplateService.create(alice.id, { name: 'y', items: [{ title: 'x', subtasks: [{ title: 'y', labelIds: [bobsLabel.id] }] }] })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('applies the tree: offsets from the anchor, subtasks, checklists, labels, company, links', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const acme = await createCustomer(alice.id, { name: 'Acme' });
    const deal = await createDeal(alice.id, { title: 'Acme renewal' });
    const label = await prisma.label.create({ data: { userId: alice.id, name: 'Ops', color: '#000000' } });
    const template = await taskTemplateService.create(alice.id, {
      name: 'Onboarding',
      items: [
        { title: 'Kickoff', dueOffsetDays: 0, priority: 'HIGH', estimatedMinutes: 60, labelIds: [label.id], checklist: ['Book room', 'Send agenda'] },
        { title: 'Review', dueOffsetDays: 7, subtasks: [{ title: 'Collect feedback', dueOffsetDays: 5 }, { title: 'Write summary' }] },
        { title: 'Someday' },
      ],
    });

    const anchor = new Date('2026-09-14T09:00:00.000Z');
    const { tasks, created } = await taskTemplateService.instantiate(alice.id, template.id, {
      anchorDate: anchor.toISOString(),
      customerId: acme.id,
      links: [{ entityType: 'deal', entityId: deal.id }],
    });

    expect(created).toBe(5);
    expect(tasks.map((t) => t.title)).toEqual(['Kickoff', 'Review', 'Someday']);
    const kickoff = tasks[0];
    expect(kickoff).toMatchObject({ priority: 'HIGH', estimatedMinutes: 60, customerId: acme.id, status: 'TODO', checklistCount: 2 });
    expect(kickoff.dueDate).toEqual(anchor);
    expect(kickoff.labels.map((l: { id: string }) => l.id)).toEqual([label.id]);
    expect(kickoff.links.map((l: { label: string }) => l.label)).toEqual(['Acme renewal']);

    const review = tasks[1];
    expect(review.dueDate).toEqual(new Date(anchor.getTime() + 7 * DAY));
    expect(review.subtasks.map((s: { title: string; dueDate: Date | null }) => [s.title, s.dueDate?.getTime() ?? null])).toEqual([
      ['Collect feedback', anchor.getTime() + 5 * DAY],
      ['Write summary', null],
    ]);
    expect(review.subtasks[0].customerId).toBe(acme.id);
    expect(tasks[2].dueDate).toBeNull();

    const again = await taskTemplateService.findById(alice.id, template.id);
    expect(again.usageCount).toBe(1);
    expect(again.lastUsedAt).not.toBeNull();
  });

  it('applies against the account\'s first non-terminal status, and refuses a foreign company', async () => {
    const { alice, bob } = await createTwoUsers();
    await prisma.taskStatus.createMany({
      data: [
        { userId: alice.id, name: 'SHIPPED', label: 'Shipped', position: 0, isTerminal: true },
        { userId: alice.id, name: 'OPEN', label: 'Open', position: 1 },
      ],
    });
    const template = await taskTemplateService.create(alice.id, { name: 't', items: [{ title: 'x' }] });
    const bobsCo = await createCustomer(bob.id, { name: 'BobsSecretCo' });

    await expect(taskTemplateService.instantiate(alice.id, template.id, { customerId: bobsCo.id })).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.task.count({ where: { userId: alice.id } })).toBe(0);

    const { tasks } = await taskTemplateService.instantiate(alice.id, template.id, {});
    expect(tasks[0].status).toBe('OPEN');
  });

  it('a link the template cannot attach does not leave the tasks half-linked or foreign-linked', async () => {
    const { alice, bob } = await createTwoUsers();
    const template = await taskTemplateService.create(alice.id, { name: 't', items: [{ title: 'x' }] });
    const bobsDeal = await createDeal(bob.id, { title: 'BobsSecretDeal' });

    await expect(
      taskTemplateService.instantiate(alice.id, template.id, { links: [{ entityType: 'deal', entityId: bobsDeal.id }] })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.taskLink.count()).toBe(0);
  });

  it('builds a template from an existing task, with offsets from its due date', async () => {
    const { alice } = await createTwoUsers();
    const label = await prisma.label.create({ data: { userId: alice.id, name: 'Ops', color: '#000000' } });
    const root = await taskService.create(alice.id, { title: 'Renewal', priority: 'HIGH', dueDate: '2026-09-14T09:00:00.000Z', labelIds: [label.id], estimatedMinutes: 30 });
    await taskService.addChecklistItem(alice.id, root.id, { text: 'Call Sam' });
    await taskService.create(alice.id, { title: 'Draft terms', parentId: root.id, dueDate: '2026-09-10T09:00:00.000Z' });
    await taskService.create(alice.id, { title: 'Sign', parentId: root.id });

    const t = await taskTemplateService.fromTask(alice.id, root.id, 'Renewal playbook');

    expect(t.taskCount).toBe(3);
    expect(t.items[0]).toMatchObject({ title: 'Renewal', priority: 'HIGH', estimatedMinutes: 30, dueOffsetDays: 0, labelIds: [label.id], checklist: ['Call Sam'] });
    expect(t.items[0].subtasks!.map((s) => [s.title, s.dueOffsetDays])).toEqual([['Draft terms', -4], ['Sign', undefined]]);
  });

  it('a share recipient saving another account\'s task keeps its shape but not its labels', async () => {
    const { alice, bob } = await createTwoUsers();
    const label = await prisma.label.create({ data: { userId: alice.id, name: 'AlicesLabel', color: '#000000' } });
    const root = await taskService.create(alice.id, { title: 'Shared', labelIds: [label.id] });
    await shareTaskWith(root.id, alice.id, bob.id);

    const t = await taskTemplateService.fromTask(bob.id, root.id, 'Copied');
    expect(t.items[0].labelIds).toEqual([]);
    expect(JSON.stringify(t)).not.toContain(label.id);
  });
});
