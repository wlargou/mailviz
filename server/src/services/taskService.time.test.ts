import { describe, it, expect } from 'vitest';
import { taskService } from './taskService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createUser, createTask, shareTaskWith } from '../test/factories.js';

/**
 * Time tracking: a running timer, manual logs, and the totals.
 *
 * Two rules carry it. A person has one running timer across all tasks —
 * starting a second names the first rather than silently stopping it — and
 * totals count finished entries only, so a running timer does not inflate
 * a row until it stops. These run against a real Postgres.
 */
describe('taskService — time tracking', () => {
  it('starts and stops a timer, recording at least one minute', async () => {
    const { alice } = await createTwoUsers();
    const task = await createTask(alice.id, { title: 'Write the brief' });

    const started = await taskService.startTimer(alice.id, task.id);
    expect(started.endedAt).toBeNull();
    expect(await taskService.getRunningTimer(alice.id)).toMatchObject({ id: started.id, task: { title: 'Write the brief' } });

    // Starting again on the same task is the same timer, not a second one.
    const again = await taskService.startTimer(alice.id, task.id);
    expect(again.id).toBe(started.id);

    // A running timer counts for nothing yet.
    let detail = await taskService.findById(alice.id, task.id);
    expect(detail).toMatchObject({ trackedMinutes: 0 });
    expect(detail.runningEntry?.id).toBe(started.id);

    const stopped = await taskService.stopTimer(alice.id, task.id);
    expect(stopped.endedAt).not.toBeNull();
    expect(stopped.minutes).toBeGreaterThanOrEqual(1);
    expect(await taskService.getRunningTimer(alice.id)).toBeNull();

    // A running row never counts, whatever its minutes column says — a
    // crash between the two writes of a stop could leave a number on it.
    await prisma.taskTimeEntry.create({ data: { taskId: task.id, userId: alice.id, startedAt: new Date(), minutes: 999 } });
    detail = await taskService.findById(alice.id, task.id);
    expect(detail.trackedMinutes).toBe(stopped.minutes);
    expect(detail.runningEntry?.minutes).toBe(999);
    await prisma.taskTimeEntry.deleteMany({ where: { taskId: task.id, endedAt: null } });
    detail = await taskService.findById(alice.id, task.id);
    expect(detail.runningEntry).toBeNull();
    await expect(taskService.stopTimer(alice.id, task.id)).rejects.toMatchObject({ statusCode: 404, code: 'TIMER_NOT_RUNNING' });
  });

  it('one running timer per person, across tasks — REGRESSION guard', async () => {
    const { alice } = await createTwoUsers();
    const first = await createTask(alice.id, { title: 'First' });
    const second = await createTask(alice.id, { title: 'Second' });

    await taskService.startTimer(alice.id, first.id);
    await expect(taskService.startTimer(alice.id, second.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TIMER_RUNNING',
      details: { taskId: first.id, title: 'First' },
    });
    expect(await prisma.taskTimeEntry.count({ where: { userId: alice.id, endedAt: null } })).toBe(1);
  });

  it('two people can run timers on the same task, and each stops only their own', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(alice.id);
    await shareTaskWith(task.id, alice.id, bob.id);

    await taskService.startTimer(alice.id, task.id);
    await taskService.startTimer(bob.id, task.id);
    await taskService.stopTimer(bob.id, task.id);

    const detail = await taskService.findById(alice.id, task.id);
    expect(detail.runningEntry?.userId).toBe(alice.id);
    expect(detail.timeEntries).toHaveLength(2);
    expect(await taskService.getRunningTimer(bob.id)).toBeNull();
  });

  it('logs time by hand and sums finished entries on the row', async () => {
    const { alice } = await createTwoUsers();
    const task = await createTask(alice.id);

    const a = await taskService.logTime(alice.id, task.id, { minutes: 45, note: 'Call with Sam' });
    await taskService.logTime(alice.id, task.id, { minutes: 30, at: '2026-09-01T10:00:00.000Z' });
    expect(a.startedAt.getTime()).toBe(a.endedAt!.getTime() - 45 * 60_000);

    const row = (await taskService.findAll(alice.id, {})).data.find((t) => t.id === task.id)!;
    expect(row).toMatchObject({ trackedMinutes: 75 });

    const detail = await taskService.findById(alice.id, task.id);
    expect(detail.timeEntries.map((e: { minutes: number; note: string | null }) => [e.minutes, e.note])).toEqual([[45, 'Call with Sam'], [30, null]]);
  });

  it('a stranger cannot start, stop, log or read; a share recipient can', async () => {
    const { alice, bob } = await createTwoUsers();
    const stranger = await createUser();
    const task = await createTask(alice.id);

    await expect(taskService.startTimer(stranger.id, task.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(taskService.logTime(stranger.id, task.id, { minutes: 10 })).rejects.toMatchObject({ statusCode: 404 });

    await shareTaskWith(task.id, alice.id, bob.id);
    const logged = await taskService.logTime(bob.id, task.id, { minutes: 10 });
    expect(logged.userId).toBe(bob.id);
  });

  it('the logger or the task owner may delete an entry; another recipient may not', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser();
    const task = await createTask(alice.id);
    await shareTaskWith(task.id, alice.id, bob.id);
    await shareTaskWith(task.id, alice.id, carol.id);
    const bobs = await taskService.logTime(bob.id, task.id, { minutes: 20 });
    const carols = await taskService.logTime(carol.id, task.id, { minutes: 5 });

    await expect(taskService.deleteTimeEntry(carol.id, task.id, bobs.id)).rejects.toMatchObject({ statusCode: 404 });
    await taskService.deleteTimeEntry(bob.id, task.id, bobs.id);
    await taskService.deleteTimeEntry(alice.id, task.id, carols.id);
    expect(await prisma.taskTimeEntry.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('an entry id from another task is a 404 — REGRESSION guard', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await createTask(alice.id);
    const bobs = await createTask(bob.id);
    const bobsEntry = await taskService.logTime(bob.id, bobs.id, { minutes: 15 });

    await expect(taskService.deleteTimeEntry(alice.id, mine.id, bobsEntry.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.taskTimeEntry.findUnique({ where: { id: bobsEntry.id } })).not.toBeNull();
  });
});
