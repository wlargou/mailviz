import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The five schedulers and the process lifecycle.
 *
 * Shutdown can only wait for the jobs it knows about, so every tick has to be
 * tracked — one that is not is cut off mid-send or mid-sync exactly as before.
 * And once draining has begun nothing new may start: stopping the crons does
 * not cancel the boot-time first runs, which are plain `setTimeout`s.
 *
 * Draining is per-process state that cannot be undone, so each test loads
 * fresh modules. Everything a tick reaches is mocked, the database included, so
 * a tick can be held open for as long as a test needs.
 */

const mocks = vi.hoisted(() => ({
  cronSchedule: vi.fn<(expression: string, fn: () => unknown) => { stop: () => void }>(),
  cronStop: vi.fn<() => void>(),
  findAccounts: vi.fn<() => Promise<Array<{ userId: string }>>>(),
  processScheduledEmails: vi.fn<() => Promise<number>>(),
  cancelRepliedFollowUps: vi.fn<() => Promise<number>>(),
  processDue: vi.fn<() => Promise<number>>(),
}));

const mockEnv = vi.hoisted(() => ({
  RUN_SCHEDULERS: true,
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
// The sync runners and the notification check all start by listing accounts.
vi.mock('../lib/prisma.js', () => ({
  prisma: { googleAuth: { findMany: mocks.findAccounts } },
}));
vi.mock('../websocket.js', () => ({ wsEmitToUser: vi.fn(), wsEmit: vi.fn(), wsEmitToUsers: vi.fn() }));
vi.mock('../services/emailService.js', () => ({
  emailService: { syncFromGmail: vi.fn(), processScheduledEmails: mocks.processScheduledEmails },
}));
vi.mock('../services/draftService.js', () => ({ draftService: { syncDrafts: vi.fn() } }));
vi.mock('../services/calendarService.js', () => ({ calendarService: { syncFromGoogle: vi.fn() } }));
vi.mock('../services/accountStatus.js', () => ({ promoteSenders: vi.fn() }));
vi.mock('./calendarPendingPush.js', () => ({ sweepPendingPushes: vi.fn() }));
vi.mock('../services/snoozeService.js', () => ({
  snoozeService: { cancelRepliedFollowUps: mocks.cancelRepliedFollowUps, processDue: mocks.processDue },
}));
vi.mock('../services/notificationService.js', () => ({
  notificationService: { createIfNotExists: vi.fn(), create: vi.fn() },
}));

async function load() {
  vi.resetModules();
  return {
    lifecycle: await import('../lib/lifecycle.js'),
    schedulers: await import('./schedulers.js'),
    email: await import('./emailSyncScheduler.js'),
    calendar: await import('./calendarSyncScheduler.js'),
    scheduledSend: await import('./scheduledSendScheduler.js'),
    snooze: await import('./snoozeScheduler.js'),
    notifications: await import('./notificationScheduler.js'),
  };
}
type Loaded = Awaited<ReturnType<typeof load>>;

/** Start one scheduler and hand back its cron callback, without its boot-time run. */
function captureTick(start: () => void): () => unknown {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cronSchedule.mockReturnValue({ stop: mocks.cronStop });
  mocks.findAccounts.mockResolvedValue([]);
  mocks.processScheduledEmails.mockResolvedValue(0);
  mocks.cancelRepliedFollowUps.mockResolvedValue(0);
  mocks.processDue.mockResolvedValue(0);
  mockEnv.RUN_SCHEDULERS = true;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('every scheduler tick is a tracked job', () => {
  // Each one is held open at the first thing it awaits.
  const cases: Array<[string, (m: Loaded) => () => void, (hold: Promise<never[]>) => void]> = [
    ['email sync', (m) => m.email.startEmailSyncScheduler, (hold) => mocks.findAccounts.mockReturnValue(hold)],
    ['calendar sync', (m) => m.calendar.startCalendarSyncScheduler, (hold) => mocks.findAccounts.mockReturnValue(hold)],
    ['scheduled send', (m) => m.scheduledSend.startScheduledSendScheduler, (hold) => mocks.processScheduledEmails.mockReturnValue(hold.then(() => 0))],
    ['snooze', (m) => m.snooze.startSnoozeScheduler, (hold) => mocks.cancelRepliedFollowUps.mockReturnValue(hold.then(() => 0))],
    ['notifications', (m) => m.notifications.startNotificationScheduler, (hold) => mocks.findAccounts.mockReturnValue(hold)],
  ];

  it.each(cases)('%s: shutdown waits for a tick in progress', async (_name, startOf, holdWith) => {
    const loaded = await load();
    const hold = deferred<never[]>();
    holdWith(hold.promise);

    const tick = captureTick(startOf(loaded));
    const running = tick();

    expect(loaded.lifecycle.pendingJobs()).toBe(1);
    let drained = false;
    const draining = loaded.lifecycle.drain(5_000).then((all) => { drained = all; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drained).toBe(false);

    hold.resolve([]);
    await running;
    await draining;
    expect(drained).toBe(true);
  });
});

describe('once draining', () => {
  it('starts no tick, from a cron or from a boot-time first run', async () => {
    const { lifecycle, schedulers } = await load();
    vi.useFakeTimers();
    schedulers.startSchedulers();
    const ticks = mocks.cronSchedule.mock.calls.map(([, fn]) => fn);
    expect(ticks).toHaveLength(5);

    lifecycle.startDraining();
    for (const tick of ticks) await tick();
    await vi.runAllTimersAsync();

    expect(mocks.findAccounts).not.toHaveBeenCalled();
    expect(mocks.processScheduledEmails).not.toHaveBeenCalled();
    expect(mocks.cancelRepliedFollowUps).not.toHaveBeenCalled();
  });

  it('does start them before draining — the check above is not vacuous', async () => {
    const { schedulers } = await load();
    vi.useFakeTimers();
    schedulers.startSchedulers();

    for (const [, tick] of mocks.cronSchedule.mock.calls) await tick();

    expect(mocks.findAccounts).toHaveBeenCalled();
    expect(mocks.processScheduledEmails).toHaveBeenCalled();
    expect(mocks.cancelRepliedFollowUps).toHaveBeenCalled();
  });
});

describe('startSchedulers / stopSchedulers', () => {
  it('starts all five, and stops all five', async () => {
    const { schedulers } = await load();
    vi.useFakeTimers();

    schedulers.startSchedulers();
    expect(mocks.cronSchedule).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(4); // every boot-time first run but scheduled send's

    schedulers.stopSchedulers();
    expect(mocks.cronStop).toHaveBeenCalledTimes(5);
  });

  it('starts nothing at all when RUN_SCHEDULERS is false', async () => {
    // Staging on a copy of production: a scheduler there sends real customers
    // the scheduled emails production already sent, and syncs real mailboxes.
    // Not even the boot-time first runs, which are what a forgotten early
    // return would leave behind.
    mockEnv.RUN_SCHEDULERS = false;
    const { schedulers } = await load();
    vi.useFakeTimers();

    schedulers.startSchedulers();

    expect(mocks.cronSchedule).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
