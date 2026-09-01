import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notificationService, DISMISS_COOLDOWN_MS } from './notificationService.js';
import { wsEmitToUser } from '../websocket.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers } from '../test/factories.js';

/**
 * Notifications are written by a cron job, not by a user action.
 *
 * `notificationScheduler` re-runs the same scan every five minutes, and for
 * every overdue task / expiring deal / imminent event it finds it calls
 * `createIfNotExists`. That means the de-duplication in `createIfNotExists` is
 * not a nicety — it is the only thing standing between one overdue task and
 * 288 identical notifications a day. Most of this file is about that guard and
 * the exact conditions under which it must *stop* suppressing (a dismissed
 * alert has to be able to fire again; a different user's copy is not a
 * duplicate).
 *
 * The rest is the usual multi-tenant surface: every read and every mutation
 * takes a userId, and `markRead`/`dismiss` use `updateMany` with `{ id, userId }`
 * rather than `update` by id — drop the `userId` and any user can mark or
 * dismiss any other user's notifications by guessing a uuid.
 */

vi.mock('../websocket.js', () => ({ wsEmitToUser: vi.fn() }));

beforeEach(() => {
  vi.mocked(wsEmitToUser).mockClear();
});

/**
 * Local fixture — notifications are created by the service under test, so the
 * shared factories deliberately do not provide one. Rows are inserted directly
 * here whenever a test needs a specific `createdAt`, read state or dismissal.
 */
async function seedNotification(
  userId: string,
  overrides: Partial<{
    type: string;
    title: string;
    entityType: string;
    entityId: string;
    isRead: boolean;
    isDismissed: boolean;
    createdAt: Date;
  }> = {}
) {
  return prisma.notification.create({
    data: {
      userId,
      type: overrides.type ?? 'TASK_OVERDUE',
      title: overrides.title ?? 'Task overdue: something',
      entityType: overrides.entityType ?? 'task',
      entityId: overrides.entityId ?? null,
      isRead: overrides.isRead ?? false,
      isDismissed: overrides.isDismissed ?? false,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  });
}

describe('notificationService.create', () => {
  it('persists the notification and pushes it to that user only', async () => {
    const { alice } = await createTwoUsers();

    const created = await notificationService.create(alice.id, {
      type: 'DEAL_EXPIRING',
      title: 'Deal expiring: Acme renewal',
      message: 'Expires in 2 days',
      entityType: 'deal',
      entityId: 'deal-1',
    });

    expect(created.userId).toBe(alice.id);
    expect(created.isRead).toBe(false);
    expect(created.isDismissed).toBe(false);

    // Without this the bell badge only updates on a page reload.
    expect(wsEmitToUser).toHaveBeenCalledTimes(1);
    expect(wsEmitToUser).toHaveBeenCalledWith(alice.id, 'notification:new', created);
  });

  it('stores omitted optional fields as null rather than undefined', async () => {
    const { alice } = await createTwoUsers();

    const created = await notificationService.create(alice.id, { type: 'TASK_OVERDUE', title: 'Overdue' });

    expect(created.message).toBeNull();
    expect(created.entityType).toBeNull();
    expect(created.entityId).toBeNull();
  });
});

describe('notificationService.createIfNotExists', () => {
  /**
   * The scheduler calls this every five minutes for the same overdue task. If
   * the de-dup check breaks, a single overdue task buries the notification
   * panel within a day.
   */
  it('returns the existing notification instead of creating a second — REGRESSION', async () => {
    const { alice } = await createTwoUsers();
    const input = {
      type: 'TASK_OVERDUE',
      title: 'Task overdue: file the report',
      entityType: 'task',
      entityId: 'task-1',
    };

    const first = await notificationService.createIfNotExists(alice.id, input);
    const second = await notificationService.createIfNotExists(alice.id, input);

    expect(second.id).toBe(first.id);
    expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(1);
    // The second call is a read, so nothing is pushed a second time either.
    expect(wsEmitToUser).toHaveBeenCalledTimes(1);
  });

  /**
   * Both users can legitimately hold a notification about the same entity id.
   * If the de-dup lookup ever loses its `userId`, the second user silently
   * never gets told.
   */
  it('de-duplicates per user, not globally', async () => {
    const { alice, bob } = await createTwoUsers();
    const input = { type: 'EVENT_STARTING', title: 'Starting soon: standup', entityType: 'event', entityId: 'evt-1' };

    const aliceOne = await notificationService.createIfNotExists(alice.id, input);
    const bobOne = await notificationService.createIfNotExists(bob.id, input);

    expect(bobOne.id).not.toBe(aliceOne.id);
    expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: bob.id } })).toBe(1);
  });

  /** A task that was "due soon" and is now overdue must be able to say so. */
  it('does not treat a different type for the same entity as a duplicate', async () => {
    const { alice } = await createTwoUsers();
    await notificationService.createIfNotExists(alice.id, {
      type: 'TASK_DUE_SOON',
      title: 'Task due soon',
      entityId: 'task-1',
    });
    await notificationService.createIfNotExists(alice.id, {
      type: 'TASK_OVERDUE',
      title: 'Task overdue',
      entityId: 'task-1',
    });

    expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(2);
  });

  /**
   * Dismissal is the user saying "I have dealt with this". A later scan is
   * still entitled to raise it again — a deal that expired is still expired
   * tomorrow — which is why dismissal suppresses rather than deletes.
   *
   * This test used to assert that the very next call re-raised it, and that
   * was the defect: the scheduler runs every five minutes, so "the next scan"
   * meant the notification returned before the user had finished reading the
   * one they dismissed. The principle here is unchanged and still asserted;
   * only the timing moved, behind DISMISS_COOLDOWN_MS.
   */
  it('creates a fresh notification once the dismissal has aged out', async () => {
    const { alice } = await createTwoUsers();
    const input = { type: 'DEAL_EXPIRED', title: 'Deal expired', entityId: 'deal-1' };

    const first = await notificationService.createIfNotExists(alice.id, input);
    await notificationService.dismiss(alice.id, first.id);
    await prisma.notification.update({
      where: { id: first.id },
      data: { dismissedAt: new Date(Date.now() - DISMISS_COOLDOWN_MS - 60_000) },
    });

    const second = await notificationService.createIfNotExists(alice.id, input);

    expect(second.id).not.toBe(first.id);
    expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(2);
  });

  /** And the half that was missing: not within the cooldown. */
  it('does not re-raise a dismissal from five minutes ago', async () => {
    const { alice } = await createTwoUsers();
    const input = { type: 'DEAL_EXPIRED', title: 'Deal expired', entityId: 'deal-2' };

    const first = await notificationService.createIfNotExists(alice.id, input);
    await notificationService.dismiss(alice.id, first.id);
    const second = await notificationService.createIfNotExists(alice.id, input);

    expect(second.id).toBe(first.id);
    expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(1);
  });

  /** A read-but-not-dismissed alert is still live, so it must not be re-raised. */
  it('still suppresses a duplicate that has merely been read', async () => {
    const { alice } = await createTwoUsers();
    const input = { type: 'TASK_OVERDUE', title: 'Task overdue', entityId: 'task-1' };

    const first = await notificationService.createIfNotExists(alice.id, input);
    await notificationService.markRead(alice.id, first.id);
    const second = await notificationService.createIfNotExists(alice.id, input);

    expect(second.id).toBe(first.id);
  });

  it('always creates when there is no entity to de-duplicate on', async () => {
    const { alice } = await createTwoUsers();
    const input = { type: 'SYSTEM', title: 'Sync finished' };

    await notificationService.createIfNotExists(alice.id, input);
    await notificationService.createIfNotExists(alice.id, input);

    expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(2);
  });
});

describe('notificationService.findAll', () => {
  it('returns only the caller’s notifications', async () => {
    const { alice, bob } = await createTwoUsers();
    await seedNotification(alice.id, { title: 'Alice alert' });
    await seedNotification(bob.id, { title: 'Bob alert' });

    const result = await notificationService.findAll(alice.id, {});

    expect(result.data.map((n) => n.title)).toEqual(['Alice alert']);
    expect(result.meta.total).toBe(1);
  });

  /** Dismissed means gone from the panel — it is the only way to clear it. */
  it('hides dismissed notifications', async () => {
    const { alice } = await createTwoUsers();
    await seedNotification(alice.id, { title: 'Live', isDismissed: false });
    await seedNotification(alice.id, { title: 'Dismissed', isDismissed: true });

    const result = await notificationService.findAll(alice.id, {});

    expect(result.data.map((n) => n.title)).toEqual(['Live']);
    expect(result.meta.total).toBe(1);
  });

  it('filters to unread when asked, and the count agrees with the page', async () => {
    const { alice } = await createTwoUsers();
    await seedNotification(alice.id, { title: 'Unread', isRead: false });
    await seedNotification(alice.id, { title: 'Read', isRead: true });

    const result = await notificationService.findAll(alice.id, { unreadOnly: true });

    expect(result.data.map((n) => n.title)).toEqual(['Unread']);
    expect(result.meta.total).toBe(1);
  });

  it('returns newest first', async () => {
    const { alice } = await createTwoUsers();
    await seedNotification(alice.id, { title: 'oldest', createdAt: new Date('2026-01-01T00:00:00Z') });
    await seedNotification(alice.id, { title: 'newest', createdAt: new Date('2026-01-03T00:00:00Z') });
    await seedNotification(alice.id, { title: 'middle', createdAt: new Date('2026-01-02T00:00:00Z') });

    const result = await notificationService.findAll(alice.id, {});

    expect(result.data.map((n) => n.title)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('paginates, and meta counts the whole filtered set rather than the page', async () => {
    const { alice } = await createTwoUsers();
    for (let i = 0; i < 5; i++) {
      await seedNotification(alice.id, { title: `n${i}`, createdAt: new Date(2026, 0, i + 1) });
    }

    const page2 = await notificationService.findAll(alice.id, { page: 2, limit: 2 });

    expect(page2.data.map((n) => n.title)).toEqual(['n2', 'n1']);
    expect(page2.meta).toEqual({ total: 5, page: 2, limit: 2, totalPages: 3 });
  });

  /** An unbounded limit from the query string would let one call load everything. */
  it('caps the page size at 100', async () => {
    const { alice } = await createTwoUsers();
    await seedNotification(alice.id);

    // Assert the row count, not just meta.limit — meta echoes the same clamped
    // local, so it stays 100 even if `take` ignores it and returns everything.
    for (let i = 0; i < 120; i++) await seedNotification(alice.id, { title: `bulk-${i}` });

    const capped = await notificationService.findAll(alice.id, { limit: 5000 });
    expect(capped.meta.limit).toBe(100);
    expect(capped.data).toHaveLength(100);
  });
});

describe('notificationService.getUnreadCount', () => {
  /** This number is the bell badge. Counting anything extra is visible on every page. */
  it('counts only the caller’s unread, undismissed notifications', async () => {
    const { alice, bob } = await createTwoUsers();
    await seedNotification(alice.id, { isRead: false, isDismissed: false });
    await seedNotification(alice.id, { isRead: false, isDismissed: false });
    await seedNotification(alice.id, { isRead: true, isDismissed: false });
    await seedNotification(alice.id, { isRead: false, isDismissed: true });
    await seedNotification(bob.id, { isRead: false, isDismissed: false });

    expect(await notificationService.getUnreadCount(alice.id)).toBe(2);
    expect(await notificationService.getUnreadCount(bob.id)).toBe(1);
  });
});

describe('notificationService.markRead / dismiss — ownership', () => {
  /**
   * `updateMany` with `{ id, userId }` is what makes a guessed uuid harmless.
   * Swap it for `update({ where: { id } })` and any authenticated user can
   * silence another user's alerts.
   */
  it('markRead does nothing to another user’s notification', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceNotification = await seedNotification(alice.id, { isRead: false });

    const result = await notificationService.markRead(bob.id, aliceNotification.id);

    expect(result.count).toBe(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: aliceNotification.id } })).isRead).toBe(false);
  });

  it('markRead marks the caller’s own notification', async () => {
    const { alice } = await createTwoUsers();
    const own = await seedNotification(alice.id, { isRead: false });

    const result = await notificationService.markRead(alice.id, own.id);

    expect(result.count).toBe(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: own.id } })).isRead).toBe(true);
  });

  it('dismiss does nothing to another user’s notification', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceNotification = await seedNotification(alice.id);

    const result = await notificationService.dismiss(bob.id, aliceNotification.id);

    expect(result.count).toBe(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: aliceNotification.id } })).isDismissed).toBe(
      false
    );
  });

  it('markAllRead touches only the caller’s unread notifications', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceUnread = await seedNotification(alice.id, { isRead: false });
    const bobUnread = await seedNotification(bob.id, { isRead: false });

    const result = await notificationService.markAllRead(alice.id);

    expect(result.count).toBe(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: aliceUnread.id } })).isRead).toBe(true);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: bobUnread.id } })).isRead).toBe(false);
  });

  /**
   * "Clear read" — dismissing an unread notification would throw away something
   * the user has never seen.
   */
  it('dismissAll clears read notifications and leaves unread ones alone', async () => {
    const { alice, bob } = await createTwoUsers();
    const read = await seedNotification(alice.id, { isRead: true });
    const unread = await seedNotification(alice.id, { isRead: false });
    const bobRead = await seedNotification(bob.id, { isRead: true });

    const result = await notificationService.dismissAll(alice.id);

    expect(result.count).toBe(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: read.id } })).isDismissed).toBe(true);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: unread.id } })).isDismissed).toBe(false);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: bobRead.id } })).isDismissed).toBe(false);
  });
});

/**
 * Dismissing a notification has to mean something for longer than five minutes.
 *
 * The scheduler calls `createIfNotExists` every five minutes, and the only
 * suppression was "an undismissed one already exists" — so dismissing cleared
 * the check and the notification came straight back, for ever, until the task
 * behind it was dealt with.
 *
 * Recreation itself stays deliberate: an overdue task is still overdue
 * tomorrow, and the existing test that pins that behaviour is left alone. What
 * changes is only how soon.
 */
describe('notificationService — the dismissal cooldown', () => {
  const input = {
    type: 'TASK_OVERDUE',
    title: 'Task overdue: file the report',
    entityType: 'task',
    entityId: 'task-cooldown',
  };

  /** Move a dismissal into the past without waiting for real time to pass. */
  async function dismissedAgo(id: string, ms: number) {
    await prisma.notification.update({
      where: { id },
      data: { isDismissed: true, dismissedAt: new Date(Date.now() - ms) },
    });
  }

  it('does not re-raise within the cooldown', async () => {
    const { alice } = await createTwoUsers();
    const first = await notificationService.createIfNotExists(alice.id, input);
    await notificationService.dismiss(alice.id, first.id);

    await notificationService.createIfNotExists(alice.id, input);

    // The scheduler's next tick must not produce a second row.
    expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(1);
  });

  it('re-raises once the cooldown has passed', async () => {
    // The other half, and the reason this is a cooldown rather than a
    // permanent suppression: the task is still overdue tomorrow.
    const { alice } = await createTwoUsers();
    const first = await notificationService.createIfNotExists(alice.id, input);
    await dismissedAgo(first.id, DISMISS_COOLDOWN_MS + 60_000);

    const second = await notificationService.createIfNotExists(alice.id, input);

    expect(second.id).not.toBe(first.id);
    expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(2);
  });

  it('stamps dismissedAt when a notification is dismissed', async () => {
    // Without the stamp the cooldown can never match and the fix is inert.
    const { alice } = await createTwoUsers();
    const n = await notificationService.createIfNotExists(alice.id, input);

    await notificationService.dismiss(alice.id, n.id);

    const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.dismissedAt).toBeInstanceOf(Date);
  });

  it('stamps dismissedAt on dismissAll too', async () => {
    // Two dismiss paths, and missing one leaves "Clear read" with no cooldown.
    const { alice } = await createTwoUsers();
    const n = await notificationService.createIfNotExists(alice.id, input);
    await notificationService.markRead(alice.id, n.id);

    await notificationService.dismissAll(alice.id);

    const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.dismissedAt).toBeInstanceOf(Date);
  });

  it('treats a dismissal with no timestamp as outside the cooldown', async () => {
    // Every row dismissed before the column existed. They must keep behaving
    // as they did, not be silenced by a timestamp they never had.
    const { alice } = await createTwoUsers();
    const first = await notificationService.createIfNotExists(alice.id, input);
    await prisma.notification.update({
      where: { id: first.id },
      data: { isDismissed: true, dismissedAt: null },
    });

    const second = await notificationService.createIfNotExists(alice.id, input);

    expect(second.id).not.toBe(first.id);
  });

  it('does not let one user’s dismissal suppress another’s notification', async () => {
    const { alice, bob } = await createTwoUsers();
    const hers = await notificationService.createIfNotExists(alice.id, input);
    await notificationService.dismiss(alice.id, hers.id);

    const his = await notificationService.createIfNotExists(bob.id, input);

    expect(his.userId).toBe(bob.id);
    expect(await prisma.notification.count({ where: { userId: bob.id } })).toBe(1);
  });

  it('does not let a dismissal of one type suppress another', async () => {
    // "Due soon" dismissed must not stop "overdue" being raised.
    const { alice } = await createTwoUsers();
    const soon = await notificationService.createIfNotExists(alice.id, {
      ...input, type: 'TASK_DUE_SOON', title: 'Task due soon',
    });
    await notificationService.dismiss(alice.id, soon.id);

    await notificationService.createIfNotExists(alice.id, input);

    expect(await prisma.notification.count({ where: { userId: alice.id, type: 'TASK_OVERDUE' } })).toBe(1);
  });
});
