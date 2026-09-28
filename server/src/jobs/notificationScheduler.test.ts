import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers } from '../test/factories.js';
import { expireStartedEventNotifications } from './notificationScheduler.js';

/**
 * "Starting soon" is only true until the meeting starts. Left up, the bell
 * kept announcing meetings three days gone.
 */
async function eventAt(userId: string, startTime: Date) {
  return prisma.calendarEvent.create({
    data: { userId, title: 'Weekly', startTime, endTime: new Date(startTime.getTime() + 3_600_000) },
  });
}

async function startingSoon(userId: string, entityId: string | null) {
  return prisma.notification.create({
    data: { userId, type: 'EVENT_STARTING', title: 'Starting soon: Weekly', entityType: 'event', entityId },
  });
}

const dismissed = async (id: string) => (await prisma.notification.findUniqueOrThrow({ where: { id } })).isDismissed;

describe('expireStartedEventNotifications', () => {
  it('takes down the notice once the meeting has started, and leaves one still ahead', async () => {
    const { alice } = await createTwoUsers();
    const now = new Date('2026-09-28T09:00:00Z');
    const started = await eventAt(alice.id, new Date('2026-09-28T08:55:00Z'));
    const ahead = await eventAt(alice.id, new Date('2026-09-28T09:10:00Z'));
    const past = await startingSoon(alice.id, started.id);
    const soon = await startingSoon(alice.id, ahead.id);

    expect(await expireStartedEventNotifications(alice.id, now)).toBe(1);

    expect(await dismissed(past.id)).toBe(true);
    expect(await dismissed(soon.id)).toBe(false);
  });

  it('takes down a notice whose meeting no longer exists, or never named one', async () => {
    const { alice } = await createTwoUsers();
    const gone = await startingSoon(alice.id, '00000000-0000-4000-8000-000000000000');
    const unnamed = await startingSoon(alice.id, null);

    await expireStartedEventNotifications(alice.id, new Date());

    expect(await dismissed(gone.id)).toBe(true);
    expect(await dismissed(unnamed.id)).toBe(true);
  });

  it("touches no other kind of notification, and no one else's", async () => {
    const { alice, bob } = await createTwoUsers();
    const started = await eventAt(bob.id, new Date('2026-09-28T08:00:00Z'));
    const bobs = await startingSoon(bob.id, started.id);
    const overdue = await prisma.notification.create({
      data: { userId: alice.id, type: 'TASK_OVERDUE', title: 'Task overdue: x', entityType: 'task', entityId: null },
    });

    await expireStartedEventNotifications(alice.id, new Date('2026-09-28T09:00:00Z'));

    expect(await dismissed(bobs.id)).toBe(false);
    expect(await dismissed(overdue.id)).toBe(false);
  });
});
