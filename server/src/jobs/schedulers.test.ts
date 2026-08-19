import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createUser, createGoogleAuth } from '../test/factories.js';

/**
 * The five background schedulers, at the seam where they meet cron.
 *
 * Two properties are worth locking down here, and neither is visible in normal
 * use — a broken scheduler is silent by construction, because its whole job is
 * to happen without anyone looking:
 *
 *  1. **A feature flag actually turns the job off.** `EMAIL_SYNC_ENABLED=false`
 *     is what gets set when Gmail quota is exhausted or a migration is in
 *     flight. A scheduler that registers its cron anyway ignores the one
 *     control there is.
 *
 *  2. **One bad account cannot stop the rest.** The per-account guard itself is
 *     covered by `perUserRunner.test.ts`; what is tested here is the layer
 *     above it — that `syncAccount` swallows its own failures, always clears
 *     the account's spinner, and sends its progress only to the account it
 *     belongs to. And, for the three single-flight schedulers, that a failed
 *     tick releases the guard so the next tick still runs. Losing that turns
 *     one transient error into a job that never runs again until restart.
 *
 * node-cron, the services and the websocket are mocked; the runner, the cron
 * wiring and the database are real.
 */

type CronCallback = () => void | Promise<void>;

interface MailSyncResult {
  synced: number;
  customersCreated: number;
  contactsCreated: number;
  labelsChanged?: number;
  failed: number;
}

interface CalendarSyncResult {
  synced: number;
  customersCreated: number;
  contactsCreated: number;
}

interface NotificationInput {
  type: string;
  title: string;
  entityType: string;
  entityId: string;
}

const mocks = vi.hoisted(() => ({
  cronSchedule: vi.fn<(expression: string, fn: () => void | Promise<void>) => { stop: () => void }>(),
  cronStop: vi.fn<() => void>(),
  syncFromGmail: vi.fn<(userId: string) => Promise<MailSyncResult>>(),
  syncDrafts: vi.fn<(userId: string) => Promise<{ synced: number; removed: number }>>(),
  syncCalendar: vi.fn<(incremental: boolean, userId: string) => Promise<CalendarSyncResult>>(),
  processScheduledEmails: vi.fn<() => Promise<number>>(),
  cancelRepliedFollowUps: vi.fn<() => Promise<number>>(),
  processDue: vi.fn<() => Promise<number>>(),
  createIfNotExists: vi.fn<(userId: string, input: NotificationInput) => Promise<void>>(),
  wsEmitToUser: vi.fn<(userId: string, event: string, data: unknown) => void>(),
  wsEmit: vi.fn<(event: string, data: unknown) => void>(),
}));

const mockEnv = vi.hoisted(() => ({
  EMAIL_SYNC_ENABLED: true,
  CALENDAR_SYNC_ENABLED: true,
  SYNC_INTERVAL_SECONDS: 60,
  CALENDAR_SYNC_INTERVAL_SECONDS: 120,
  SYNC_MAX_CONCURRENT_ACCOUNTS: 3,
}));

vi.mock('../config/env.js', () => ({ env: mockEnv }));
vi.mock('node-cron', () => ({
  schedule: mocks.cronSchedule,
  default: { schedule: mocks.cronSchedule },
}));
vi.mock('../websocket.js', () => ({
  wsEmitToUser: mocks.wsEmitToUser,
  wsEmit: mocks.wsEmit,
  wsEmitToUsers: vi.fn(),
}));
vi.mock('../services/emailService.js', () => ({
  emailService: {
    syncFromGmail: mocks.syncFromGmail,
    processScheduledEmails: mocks.processScheduledEmails,
  },
}));
vi.mock('../services/draftService.js', () => ({
  draftService: { syncDrafts: mocks.syncDrafts },
}));
vi.mock('../services/calendarService.js', () => ({
  calendarService: { syncFromGoogle: mocks.syncCalendar },
}));
vi.mock('../services/snoozeService.js', () => ({
  snoozeService: {
    cancelRepliedFollowUps: mocks.cancelRepliedFollowUps,
    processDue: mocks.processDue,
  },
}));
vi.mock('../services/notificationService.js', () => ({
  notificationService: { createIfNotExists: mocks.createIfNotExists },
}));

const { startEmailSyncScheduler, stopEmailSyncScheduler, syncAccountNow, isSyncInProgressFor } =
  await import('./emailSyncScheduler.js');
const { startCalendarSyncScheduler, stopCalendarSyncScheduler, syncCalendarNow } =
  await import('./calendarSyncScheduler.js');
const { startScheduledSendScheduler, stopScheduledSendScheduler } =
  await import('./scheduledSendScheduler.js');
const { startSnoozeScheduler, stopSnoozeScheduler } = await import('./snoozeScheduler.js');
const { startNotificationScheduler, stopNotificationScheduler } =
  await import('./notificationScheduler.js');

const okMailSync: MailSyncResult = {
  synced: 0,
  customersCreated: 0,
  contactsCreated: 0,
  labelsChanged: 0,
  failed: 0,
};
const okCalendarSync: CalendarSyncResult = { synced: 0, customersCreated: 0, contactsCreated: 0 };

/**
 * Start a scheduler and hand back the function cron would call on each tick.
 *
 * Fake timers only for the call itself: every `start*` also queues a delayed
 * first run, and letting that escape would fire a sync into a later test. The
 * tick is then invoked under real timers because it talks to Postgres.
 */
function captureTick(start: () => void): CronCallback {
  vi.useFakeTimers();
  try {
    start();
    const call = mocks.cronSchedule.mock.calls.at(-1);
    if (!call) throw new Error('the scheduler registered no cron job');
    return call[1];
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
}

function lastCronExpression(): string {
  const call = mocks.cronSchedule.mock.calls.at(-1);
  if (!call) throw new Error('the scheduler registered no cron job');
  return call[0];
}

/** Events this account received, as `event` strings in order. */
function eventsFor(userId: string): Array<{ event: string; data: unknown }> {
  return mocks.wsEmitToUser.mock.calls
    .filter(([id]) => id === userId)
    .map(([, event, data]) => ({ event, data }));
}

async function createConnectedUser() {
  const user = await createUser();
  await createGoogleAuth(user.id);
  return user;
}

async function createOverdueTask(userId: string, title: string) {
  return prisma.task.create({
    data: { userId, title, status: 'TODO', dueDate: new Date(Date.now() - 60_000) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cronSchedule.mockReturnValue({ stop: mocks.cronStop });
  mocks.syncFromGmail.mockResolvedValue(okMailSync);
  mocks.syncDrafts.mockResolvedValue({ synced: 0, removed: 0 });
  mocks.syncCalendar.mockResolvedValue(okCalendarSync);
  mocks.processScheduledEmails.mockResolvedValue(0);
  mocks.cancelRepliedFollowUps.mockResolvedValue(0);
  mocks.processDue.mockResolvedValue(0);
  mocks.createIfNotExists.mockResolvedValue(undefined);

  mockEnv.EMAIL_SYNC_ENABLED = true;
  mockEnv.CALENDAR_SYNC_ENABLED = true;
  mockEnv.SYNC_INTERVAL_SECONDS = 60;
  mockEnv.CALENDAR_SYNC_INTERVAL_SECONDS = 120;

  // The schedulers log per tick; silence it so a failing assertion is readable.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  stopEmailSyncScheduler();
  stopCalendarSyncScheduler();
  stopScheduledSendScheduler();
  stopSnoozeScheduler();
  stopNotificationScheduler();
  vi.restoreAllMocks();
});

describe('feature flags', () => {
  it('registers nothing at all when EMAIL_SYNC_ENABLED is false', () => {
    // The flag is the kill switch used when Gmail quota is spent. Returning
    // early but still queueing the delayed first run — easy to leave behind —
    // means the sync everyone thinks is off still runs once per boot.
    mockEnv.EMAIL_SYNC_ENABLED = false;
    vi.useFakeTimers();

    startEmailSyncScheduler();

    expect(mocks.cronSchedule).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('registers nothing at all when CALENDAR_SYNC_ENABLED is false', () => {
    mockEnv.CALENDAR_SYNC_ENABLED = false;
    vi.useFakeTimers();

    startCalendarSyncScheduler();

    expect(mocks.cronSchedule).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves the other scheduler alone when only one flag is off', () => {
    // The two flags are independent; a shared early-return would silence both.
    mockEnv.EMAIL_SYNC_ENABLED = false;
    captureTick(startCalendarSyncScheduler);

    expect(mocks.cronSchedule).toHaveBeenCalledTimes(1);
    expect(lastCronExpression()).toBe('*/2 * * * *');
  });

  it('schedules both syncs at their configured intervals when enabled', () => {
    captureTick(startEmailSyncScheduler);
    expect(lastCronExpression()).toBe('*/1 * * * *');

    captureTick(startCalendarSyncScheduler);
    expect(lastCronExpression()).toBe('*/2 * * * *');
  });

  it('clamps an interval below ten seconds to something cron accepts', async () => {
    // Without the Math.max(10, …) floor, SYNC_INTERVAL_SECONDS=0 yields
    // `*/0 * * * * *` and node-cron throws `Invalid array length` — out of
    // startEmailSyncScheduler, out of index.ts, before the server ever listens.
    const cron = await vi.importActual<typeof import('node-cron')>('node-cron');
    mockEnv.SYNC_INTERVAL_SECONDS = 0;
    mockEnv.CALENDAR_SYNC_INTERVAL_SECONDS = 3;

    captureTick(startEmailSyncScheduler);
    expect(lastCronExpression()).toBe('*/10 * * * * *');
    expect(cron.validate(lastCronExpression())).toBe(true);

    captureTick(startCalendarSyncScheduler);
    expect(lastCronExpression()).toBe('*/10 * * * * *');
    expect(cron.validate(lastCronExpression())).toBe(true);
  });
});

describe('emailSyncScheduler — one bad account', () => {
  it('syncs the remaining accounts after one of them throws', async () => {
    const [first, broken, last] = [
      await createConnectedUser(),
      await createConnectedUser(),
      await createConnectedUser(),
    ];
    mocks.syncFromGmail.mockImplementation(async (userId: string) => {
      if (userId === broken.id) throw new Error('Gmail is having a day');
      return okMailSync;
    });

    await captureTick(startEmailSyncScheduler)();

    const synced = mocks.syncFromGmail.mock.calls.map(([id]) => id);
    expect(synced).toContain(first.id);
    expect(synced).toContain(last.id);
    expect(synced).toHaveLength(3);
  });

  it('clears the failing account’s spinner instead of leaving it running', async () => {
    // The `syncing: false` event lives in a `finally`. Drop it and a single
    // failed sync leaves that user's indicator spinning until they reload —
    // and, because the status never flips, looking permanently stuck.
    const user = await createConnectedUser();
    mocks.syncFromGmail.mockRejectedValue(new Error('boom'));
    mocks.syncDrafts.mockRejectedValue(new Error('boom too'));

    await captureTick(startEmailSyncScheduler)();

    expect(eventsFor(user.id).map((e) => e.event)).toEqual(['sync:status', 'sync:status']);
    expect(eventsFor(user.id).at(0)?.data).toEqual({ syncing: true });
    expect(eventsFor(user.id).at(-1)?.data).toEqual({ syncing: false });
    expect(isSyncInProgressFor(user.id)).toBe(false);
  });

  it('finishes the mail sync even when draft reconciliation fails', async () => {
    // Drafts are a side errand. A drafts.list failure must not discard the
    // mail we just synced or mark the account as failed.
    const user = await createConnectedUser();
    mocks.syncFromGmail.mockResolvedValue({ ...okMailSync, synced: 4 });
    mocks.syncDrafts.mockRejectedValue(new Error('drafts exploded'));

    await captureTick(startEmailSyncScheduler)();

    const events = eventsFor(user.id);
    expect(events.map((e) => e.event)).toContain('emails:synced');
    expect(events.at(-1)).toEqual({ event: 'sync:status', data: { syncing: false } });
    // Without the drafts try/catch the rejection escapes to the runner, which
    // records the whole account as failed — a permanent error line for a
    // mailbox that synced perfectly well.
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining('Sync failed for'),
      expect.anything()
    );
  });

  it('sends each account its own progress and never broadcasts — REGRESSION', async () => {
    // These events used to go out with `wsEmit`, to every connected socket. It
    // lit up every user's sync indicator whenever anybody synced, and the
    // counts in the payload leaked one mailbox's volume to everyone else.
    const alice = await createConnectedUser();
    const bob = await createConnectedUser();
    mocks.syncFromGmail.mockImplementation(async (userId: string) =>
      userId === alice.id ? { ...okMailSync, synced: 7, customersCreated: 2 } : okMailSync
    );

    await captureTick(startEmailSyncScheduler)();

    expect(mocks.wsEmit).not.toHaveBeenCalled();
    const aliceSynced = eventsFor(alice.id).find((e) => e.event === 'emails:synced');
    expect(aliceSynced?.data).toMatchObject({ synced: 7, customersCreated: 2 });
    // Bob synced nothing, so he must hear nothing about Alice's seven.
    expect(eventsFor(bob.id).some((e) => e.event === 'emails:synced')).toBe(false);
  });

  it('syncs only the named account through syncAccountNow', async () => {
    // The login callback calls this so a brand-new account is not empty for a
    // whole interval. Syncing everybody there would make one person's login
    // kick off every other account's mailbox.
    const target = await createConnectedUser();
    await createConnectedUser();

    await syncAccountNow(target.id);

    expect(mocks.syncFromGmail.mock.calls.map(([id]) => id)).toEqual([target.id]);
  });

  it('stops the cron job on shutdown and tolerates a second stop', () => {
    captureTick(startEmailSyncScheduler);

    stopEmailSyncScheduler();
    stopEmailSyncScheduler();

    expect(mocks.cronStop).toHaveBeenCalledTimes(1);
  });
});

describe('calendarSyncScheduler — one bad account', () => {
  it('syncs the remaining accounts after one of them throws, and clears its spinner', async () => {
    const broken = await createConnectedUser();
    const healthy = await createConnectedUser();
    mocks.syncCalendar.mockImplementation(async (_incremental: boolean, userId: string) => {
      if (userId === broken.id) throw new Error('calendar is down');
      return { ...okCalendarSync, synced: 3 };
    });

    await captureTick(startCalendarSyncScheduler)();

    expect(mocks.syncCalendar).toHaveBeenCalledTimes(2);
    expect(eventsFor(healthy.id).some((e) => e.event === 'calendar:synced')).toBe(true);
    expect(eventsFor(broken.id).at(-1)).toEqual({
      event: 'calendar:sync:status',
      data: { syncing: false },
    });
  });

  it('does not log an error for an account that has not connected Google', async () => {
    // status 400 is the expected answer for a user without Google. Logging it
    // means an error line per account per tick, for ever — which is how real
    // failures stop being noticed.
    const user = await createConnectedUser();
    mocks.syncCalendar.mockRejectedValue(Object.assign(new Error('Google not connected'), { status: 400 }));

    await captureTick(startCalendarSyncScheduler)();

    expect(console.error).not.toHaveBeenCalled();
    expect(eventsFor(user.id).at(-1)).toEqual({
      event: 'calendar:sync:status',
      data: { syncing: false },
    });
  });

  it('does log an error for a failure that is not "not connected"', async () => {
    await createConnectedUser();
    mocks.syncCalendar.mockRejectedValue(Object.assign(new Error('quota'), { status: 500 }));

    await captureTick(startCalendarSyncScheduler)();

    expect(console.error).toHaveBeenCalled();
  });

  it('syncs only the named account through syncCalendarNow', async () => {
    const target = await createConnectedUser();
    await createConnectedUser();

    await syncCalendarNow(target.id);

    expect(mocks.syncCalendar.mock.calls.map(([, id]) => id)).toEqual([target.id]);
  });
});

describe('single-flight schedulers release their guard on failure', () => {
  it('runs scheduled sends again after a tick throws — REGRESSION', async () => {
    // `isProcessing` is cleared in a `finally`. Without it, the first error
    // wedges the flag on and no scheduled email is ever sent again until the
    // process restarts — with no log line after the first one to say so.
    mocks.processScheduledEmails
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValue(2);
    const tick = captureTick(startScheduledSendScheduler);

    await tick();
    await tick();

    expect(mocks.processScheduledEmails).toHaveBeenCalledTimes(2);
  });

  it('runs the snooze check again after a tick throws — REGRESSION', async () => {
    // Same guard, same consequence: snoozed threads stop waking up and
    // follow-up reminders stop firing, silently.
    mocks.cancelRepliedFollowUps.mockRejectedValueOnce(new Error('db blip')).mockResolvedValue(0);
    const tick = captureTick(startSnoozeScheduler);

    await tick();
    await tick();

    expect(mocks.cancelRepliedFollowUps).toHaveBeenCalledTimes(2);
    expect(mocks.processDue).toHaveBeenCalledTimes(1);
  });

  it('clears replied follow-ups before firing what is due', async () => {
    // Order matters: a thread that already got a reply must be disarmed in the
    // same tick that would otherwise send its reminder.
    const tick = captureTick(startSnoozeScheduler);

    await tick();

    expect(mocks.cancelRepliedFollowUps.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.processDue.mock.invocationCallOrder[0]
    );
  });

  it('polls scheduled sends and snoozes every 30 seconds', () => {
    // The user picked a minute; half a minute of slack is the resolution that
    // makes "send at 09:00" mean 09:00.
    captureTick(startScheduledSendScheduler);
    expect(lastCronExpression()).toBe('*/30 * * * * *');

    captureTick(startSnoozeScheduler);
    expect(lastCronExpression()).toBe('*/30 * * * * *');
  });
});

describe('notificationScheduler', () => {
  it('still notifies the next account after one account errors', async () => {
    // The per-user try/catch is the only thing standing between one user's bad
    // row and everybody else's notifications for that tick.
    const alice = await createConnectedUser();
    const bob = await createConnectedUser();
    await createOverdueTask(alice.id, 'Alice overdue');
    await createOverdueTask(bob.id, 'Bob overdue');

    // Fail whichever account the scheduler happens to reach first, so the test
    // does not depend on the row order googleAuth comes back in.
    let firstReached: string | null = null;
    mocks.createIfNotExists.mockImplementation(async (userId: string) => {
      if (firstReached === null) {
        firstReached = userId;
        throw new Error('notification write failed');
      }
    });

    await captureTick(startNotificationScheduler)();

    const reached = new Set(mocks.createIfNotExists.mock.calls.map(([userId]) => userId));
    expect(reached).toEqual(new Set([alice.id, bob.id]));
  });

  it('raises an overdue notification against the owning user only', async () => {
    const alice = await createConnectedUser();
    const bob = await createConnectedUser();
    const aliceTask = await createOverdueTask(alice.id, 'Alice only');

    await captureTick(startNotificationScheduler)();

    const forAliceTask = mocks.createIfNotExists.mock.calls.filter(
      ([, payload]) => payload.entityId === aliceTask.id
    );
    expect(forAliceTask).toHaveLength(1);
    expect(forAliceTask[0][0]).toBe(alice.id);
    expect(mocks.createIfNotExists.mock.calls.some(([userId]) => userId === bob.id)).toBe(false);
  });

  it('skips accounts that have not connected Google', async () => {
    // The scheduler walks googleAuth rows, not users. A user who never
    // connected has no mail or calendar to be reminded about.
    const disconnected = await createUser();
    await createOverdueTask(disconnected.id, 'Nobody should see this');

    await captureTick(startNotificationScheduler)();

    expect(mocks.createIfNotExists).not.toHaveBeenCalled();
  });
});
