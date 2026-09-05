import { describe, it, expect } from 'vitest';
import { taskService } from './taskService.js';
import { auditService } from './auditService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createTask, createCustomer, seedTaskStatuses } from '../test/factories.js';

/**
 * Recurring tasks: finishing one occurrence creates the next.
 *
 * The spawn happens after the status write and claims `recurrenceNextId`
 * with a conditional update, so it happens once however the task was
 * finished — the panel, the Kanban drag, a subtask checkbox — and never
 * twice for one occurrence. These run against a real Postgres.
 */
const WEEKLY_MON = 'RRULE:FREQ=WEEKLY;BYDAY=MO';

describe('taskService — recurrence', () => {
  it('a repeating task needs a due date, on create and on update', async () => {
    const { alice } = await createTwoUsers();
    await expect(taskService.create(alice.id, { title: 'Report', recurrence: WEEKLY_MON })).rejects.toMatchObject({
      statusCode: 400,
      code: 'RECURRENCE_NEEDS_DUE_DATE',
    });

    const task = await taskService.create(alice.id, { title: 'Report', recurrence: WEEKLY_MON, dueDate: '2026-09-07T09:00:00.000Z' });
    expect(task.recurrence).toBe(WEEKLY_MON);

    // Clearing the due date while the rule stays is refused too.
    await expect(taskService.update(alice.id, task.id, { dueDate: null })).rejects.toMatchObject({ code: 'RECURRENCE_NEEDS_DUE_DATE' });
    // Clearing both together is fine.
    const cleared = await taskService.update(alice.id, task.id, { dueDate: null, recurrence: null });
    expect(cleared.recurrence).toBeNull();
  });

  it('finishing creates the next occurrence with everything carried over and the checklist unticked', async () => {
    const { alice, bob } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const acme = await createCustomer(alice.id, { name: 'Acme' });
    const label = await prisma.label.create({ data: { userId: alice.id, name: 'Ops', color: '#000000' } });
    const parent = await createTask(alice.id, { title: 'Parent' });
    const task = await taskService.create(alice.id, {
      title: 'Weekly report',
      description: 'Numbers for the team',
      priority: 'HIGH',
      estimatedMinutes: 30,
      customerId: acme.id,
      assignedToId: bob.id,
      labelIds: [label.id],
      parentId: parent.id,
      recurrence: WEEKLY_MON,
      dueDate: '2026-09-07T09:00:00.000Z',
      status: 'TODO',
    });
    const step = await taskService.addChecklistItem(alice.id, task.id, { text: 'Pull the numbers' });
    await taskService.updateChecklistItem(alice.id, task.id, step.id, { isDone: true });

    const done = await taskService.update(alice.id, task.id, { status: 'DONE' });
    await auditService.flush();

    const finished = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(finished.recurrenceNextId).not.toBeNull();
    expect(done.status).toBe('DONE');

    const next = await taskService.findById(alice.id, finished.recurrenceNextId!);
    expect(next).toMatchObject({
      title: 'Weekly report',
      description: 'Numbers for the team',
      priority: 'HIGH',
      estimatedMinutes: 30,
      customerId: acme.id,
      assignedToId: bob.id,
      parentId: parent.id,
      recurrence: WEEKLY_MON,
      status: 'TODO',
      recurrenceNextId: null,
    });
    expect(next.labels.map((l: { id: string }) => l.id)).toEqual([label.id]);
    expect(next.dueDate!.getTime()).toBeGreaterThan(Date.now());
    expect(next.dueDate!.getDay()).toBe(1); // a Monday
    expect(next.checklist!.map((c: { text: string; isDone: boolean }) => [c.text, c.isDone])).toEqual([['Pull the numbers', false]]);
    expect(next.recurrencePrevious).toMatchObject({ id: task.id, title: 'Weekly report' });

    const previous = await taskService.findById(alice.id, task.id);
    expect(previous.recurrenceNext).toMatchObject({ id: next.id, status: 'TODO' });

    const created = await prisma.auditLog.findFirst({ where: { entityId: next.id, action: 'TASK_CREATED' } });
    expect(created!.details).toMatchObject({ previousId: task.id, recurrence: WEEKLY_MON });
  });

  it('spawns once: reopening and finishing again does not fork the series — REGRESSION guard', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const task = await taskService.create(alice.id, { title: 'Standup notes', recurrence: 'RRULE:FREQ=DAILY', dueDate: '2026-09-07T09:00:00.000Z' });

    await taskService.update(alice.id, task.id, { status: 'DONE' });
    await taskService.update(alice.id, task.id, { status: 'TODO' });
    await taskService.update(alice.id, task.id, { status: 'DONE' });

    expect(await prisma.task.count({ where: { title: 'Standup notes' } })).toBe(2);
  });

  it('a move to a non-terminal status spawns nothing; a Kanban drag into a finished column does', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const task = await taskService.create(alice.id, { title: 'Invoice run', recurrence: 'RRULE:FREQ=MONTHLY;BYMONTHDAY=1', dueDate: '2026-09-01T09:00:00.000Z' });

    await taskService.update(alice.id, task.id, { status: 'IN_PROGRESS' });
    expect(await prisma.task.count({ where: { title: 'Invoice run' } })).toBe(1);

    await taskService.reorder(alice.id, { items: [{ id: task.id, status: 'DONE', position: 1000 }] });
    expect(await prisma.task.count({ where: { title: 'Invoice run' } })).toBe(2);
    const next = await prisma.task.findFirstOrThrow({ where: { title: 'Invoice run', id: { not: task.id } } });
    expect(next.dueDate!.getDate()).toBe(1);
  });

  it('"finished" is the account\'s terminal statuses, not the name DONE', async () => {
    const { alice } = await createTwoUsers();
    await prisma.taskStatus.createMany({
      data: [
        { userId: alice.id, name: 'OPEN', label: 'Open', position: 0 },
        { userId: alice.id, name: 'DONE', label: 'Parked', position: 1 }, // NOT terminal here
        { userId: alice.id, name: 'SHIPPED', label: 'Shipped', position: 2, isTerminal: true },
      ],
    });
    const task = await taskService.create(alice.id, { title: 'Release', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=FR', dueDate: '2026-09-04T09:00:00.000Z', status: 'OPEN' });

    await taskService.update(alice.id, task.id, { status: 'DONE' });
    expect(await prisma.task.count({ where: { title: 'Release' } })).toBe(1);

    await taskService.update(alice.id, task.id, { status: 'SHIPPED' });
    expect(await prisma.task.count({ where: { title: 'Release' } })).toBe(2);
    const next = await prisma.task.findFirstOrThrow({ where: { title: 'Release', id: { not: task.id } } });
    // The next occurrence opens in the account's first non-terminal status.
    expect(next.status).toBe('OPEN');
  });

  it('a task without a rule spawns nothing when finished', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const task = await taskService.create(alice.id, { title: 'One-off', dueDate: '2026-09-07T09:00:00.000Z' });
    await taskService.update(alice.id, task.id, { status: 'DONE' });
    expect(await prisma.task.count({ where: { title: 'One-off' } })).toBe(1);
  });
});
