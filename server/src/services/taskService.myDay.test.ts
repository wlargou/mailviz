import { describe, it, expect } from 'vitest';
import { taskService } from './taskService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createTask, shareTaskWith, seedTaskStatuses } from '../test/factories.js';

/**
 * Start dates, reminders and the My Day buckets.
 *
 * The buckets are computed in the user's own timezone, so the fixtures pin
 * the account to UTC and build instants against UTC midnight — the point is
 * which bucket a task lands in, and that each lands in exactly one.
 */
const DAY = 24 * 60 * 60 * 1000;

function utcMidnightToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

describe('taskService — start dates and reminders', () => {
  it('a start date after the due date is refused, on create and on update', async () => {
    const { alice } = await createTwoUsers();
    await expect(
      taskService.create(alice.id, { title: 'x', startDate: '2026-09-10T00:00:00.000Z', dueDate: '2026-09-09T00:00:00.000Z' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'START_AFTER_DUE' });

    const task = await taskService.create(alice.id, { title: 'x', startDate: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-09T00:00:00.000Z' });
    expect(task.startDate).toEqual(new Date('2026-09-01T00:00:00.000Z'));

    // Moving only the due date before the existing start is refused too.
    await expect(taskService.update(alice.id, task.id, { dueDate: '2026-08-30T00:00:00.000Z' })).rejects.toMatchObject({ code: 'START_AFTER_DUE' });
    // Moving both together is fine.
    const moved = await taskService.update(alice.id, task.id, { startDate: '2026-08-20T00:00:00.000Z', dueDate: '2026-08-30T00:00:00.000Z' });
    expect(moved.startDate).toEqual(new Date('2026-08-20T00:00:00.000Z'));
  });

  it('changing the reminder time re-arms a reminder that already fired', async () => {
    const { alice } = await createTwoUsers();
    const task = await taskService.create(alice.id, { title: 'x', remindAt: '2026-09-01T09:00:00.000Z' });
    await prisma.task.update({ where: { id: task.id }, data: { reminderSentAt: new Date() } });

    const untouched = await taskService.update(alice.id, task.id, { title: 'y' });
    expect(untouched.reminderSentAt).not.toBeNull();

    const rearmed = await taskService.update(alice.id, task.id, { remindAt: '2026-09-02T09:00:00.000Z' });
    expect(rearmed.reminderSentAt).toBeNull();
  });
});

describe('taskService.findMyDay', () => {
  it('sorts reachable, unfinished tasks into overdue, due today, starting today and upcoming — once each', async () => {
    const { alice, bob } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    await prisma.user.update({ where: { id: alice.id }, data: { timezone: 'UTC' } });
    const today = utcMidnightToday();

    const overdue = await createTask(alice.id, { title: 'overdue', dueDate: new Date(today.getTime() - DAY) });
    const dueToday = await createTask(alice.id, { title: 'due today', dueDate: new Date(today.getTime() + 15 * 60 * 60 * 1000) });
    const starting = await prisma.task.create({
      data: { userId: alice.id, title: 'starting today', startDate: new Date(today.getTime() + 60 * 60 * 1000), dueDate: new Date(today.getTime() + 5 * DAY) },
    });
    const upcoming = await createTask(alice.id, { title: 'upcoming', dueDate: new Date(today.getTime() + 3 * DAY) });
    await createTask(alice.id, { title: 'far away', dueDate: new Date(today.getTime() + 30 * DAY) });
    await createTask(alice.id, { title: 'undated' });
    await createTask(alice.id, { title: 'finished overdue', dueDate: new Date(today.getTime() - DAY), status: 'DONE' });
    // Shared in from Bob, overdue: reachable, so it counts.
    const shared = await createTask(bob.id, { title: 'shared overdue', dueDate: new Date(today.getTime() - 2 * DAY) });
    await shareTaskWith(shared.id, bob.id, alice.id);
    await createTask(bob.id, { title: 'BobsSecretTask', dueDate: new Date(today.getTime() - DAY) });

    const { data, meta } = await taskService.findMyDay(alice.id);

    expect(data.overdue.map((t) => t.title).sort()).toEqual(['overdue', 'shared overdue']);
    expect(data.dueToday.map((t) => t.title)).toEqual(['due today']);
    expect(data.startingToday.map((t) => t.title)).toEqual(['starting today']);
    expect(data.upcoming.map((t) => t.title)).toEqual(['upcoming']);
    expect(meta.total).toBe(4);
    expect(JSON.stringify(data)).not.toContain('BobsSecretTask');
    expect(JSON.stringify(data)).not.toContain('finished overdue');

    // One bucket each: a task both starting today and due in the week is
    // "starting today", not also "upcoming".
    const all = [...data.overdue, ...data.dueToday, ...data.startingToday, ...data.upcoming].map((t) => t.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain(overdue.id);
    expect(all).toContain(dueToday.id);
    expect(all).toContain(starting.id);
    expect(all).toContain(upcoming.id);
  });

  it('"today" is the user\'s day, not the server\'s — REGRESSION guard', async () => {
    // 23:30 UTC is already tomorrow in Auckland (UTC+12/13). A task due at
    // 23:30 UTC today is therefore "overdue"-adjacent for a UTC user and due
    // tomorrow for the Auckland one — it must not sit in "due today" there.
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const today = utcMidnightToday();
    const lateTonightUtc = new Date(today.getTime() + 23.5 * 60 * 60 * 1000);
    await createTask(alice.id, { title: 'late tonight', dueDate: lateTonightUtc });

    await prisma.user.update({ where: { id: alice.id }, data: { timezone: 'UTC' } });
    const asUtc = await taskService.findMyDay(alice.id);
    expect(asUtc.data.dueToday.map((t) => t.title)).toEqual(['late tonight']);

    await prisma.user.update({ where: { id: alice.id }, data: { timezone: 'Pacific/Auckland' } });
    const asAuckland = await taskService.findMyDay(alice.id);
    // Depending on the hour the test runs, Auckland is either already on
    // that date (then the task is "due today" there too) or a day ahead of it
    // (then it is upcoming or overdue) — but the bucket must be derived from
    // Auckland's calendar, which `meta.today` exposes.
    expect(asAuckland.meta.timezone).toBe('Pacific/Auckland');
    expect(asAuckland.meta.today.getTime()).not.toBe(asUtc.meta.today.getTime());
  });
});
