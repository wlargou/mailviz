import * as cron from 'node-cron';
import { calendarService } from '../services/calendarService.js';
import { env } from '../config/env.js';
import { wsEmitToUser } from '../websocket.js';
import { secondsToCron } from '../utils/shared.js';
import { createPerUserRunner } from './perUserRunner.js';
import { sweepPendingPushes } from './calendarPendingPush.js';

let syncTask: ReturnType<typeof cron.schedule> | null = null;

async function syncAccount(userId: string): Promise<void> {
  // Per-account, like the mail scheduler — see the note there.
  wsEmitToUser(userId, 'calendar:sync:status', { syncing: true });
  try {
    /**
     * Before the pull, not after: a retry that lands means Google already holds
     * our version by the time the sync lists it, so the row converges on this
     * tick instead of staying skipped until the next one.
     *
     * Its own try/catch — a failing retry must not cost the account its sync.
     * Running here also puts the push under `perUserRunner`'s per-account
     * guard for free, so it can never race that account's own sync.
     */
    try {
      await sweepPendingPushes(userId);
    } catch (err) {
      console.error('[CalendarSync] Pending-push sweep failed:', (err as Error)?.message ?? err);
    }

    const result = await calendarService.syncFromGoogle(false, userId);
    const hasChanges = result.synced > 0 || result.customersCreated > 0 || result.contactsCreated > 0;
    if (hasChanges) {
      console.log(
        `[CalendarSync] Synced ${result.synced} events, ${result.customersCreated} companies, ${result.contactsCreated} contacts`
      );
      wsEmitToUser(userId, 'calendar:synced', {
        synced: result.synced,
        customersCreated: result.customersCreated,
        contactsCreated: result.contactsCreated,
      });
    }
  } catch (err: any) {
    if (err?.status === 400) {
      // Google not connected — silently skip
    } else {
      console.error('[CalendarSync] Sync failed:', err?.message || err);
    }
  } finally {
    // In a finally so a thrown sync still clears the indicator — otherwise a
    // single failure leaves the spinner running until the page is reloaded.
    wsEmitToUser(userId, 'calendar:sync:status', { syncing: false });
  }
}

// Per-account guard, not global: a long first sync for one account must not hold
// up everybody else's calendar. See jobs/perUserRunner.ts.
const runner = createPerUserRunner({
  label: 'CalendarSync',
  concurrency: env.SYNC_MAX_CONCURRENT_ACCOUNTS,
  run: syncAccount,
});

export function startCalendarSyncScheduler() {
  if (!env.CALENDAR_SYNC_ENABLED) {
    console.log('[CalendarSync] Background sync disabled (CALENDAR_SYNC_ENABLED=false)');
    return;
  }

  const interval = Math.max(10, env.CALENDAR_SYNC_INTERVAL_SECONDS);
  const cronExpr = secondsToCron(interval);

  console.log(`[CalendarSync] Starting background sync every ${interval}s (cron: ${cronExpr})`);

  syncTask = cron.schedule(cronExpr, () => runner.runAll());

  // Run an initial sync 10 seconds after startup (staggered from email sync at 5s)
  setTimeout(() => void runner.runAll(), 10000);
}

export function stopCalendarSyncScheduler() {
  if (syncTask) {
    syncTask.stop();
    syncTask = null;
    console.log('[CalendarSync] Background sync stopped');
  }
}

/**
 * Whether this account's calendar is mid-sync.
 *
 * Per-account now that the guard is. Answered globally, the endpoint told a user
 * their calendar was syncing because somebody else's was.
 */
export function isCalendarSyncInProgress(userId: string): boolean {
  return runner.isInFlight(userId);
}

/** Start a calendar sync for one account immediately — see the mail equivalent. */
export function syncCalendarNow(userId: string): Promise<void> {
  return runner.runOne(userId);
}

/**
 * Run a manual calendar sync under the same guard the cron tick uses.
 *
 * The Sync button called the service directly, outside the runner entirely, so
 * it could overlap a scheduled tick for the same account. That is not merely
 * duplicated work: the sync token is null for the whole duration of a full
 * sync, so a second sync starting inside one also takes the full branch, and
 * each then runs the reconciliation `deleteMany` that removes local rows absent
 * from *its own* listing. One sync deletes what the other has just written, and
 * an incremental sync cannot restore them — absence from a delta is normal, so
 * the rows stay gone until the next full sync.
 *
 * `runExclusive`, not `runOne`: `runOne` swallows the error and returns void,
 * which would turn the "Google not connected" 400 into a 200.
 *
 * Returns `{ ran: false }` when a sync is already going, so the caller can say
 * so rather than starting a second one.
 */
export function runCalendarManualSync<T>(userId: string, job: () => Promise<T>) {
  return runner.runExclusive(userId, job);
}
