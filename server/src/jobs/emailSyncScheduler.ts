import * as cron from 'node-cron';
import { emailService } from '../services/emailService.js';
import { draftService } from '../services/draftService.js';
import { env } from '../config/env.js';
import { wsEmitToUser } from '../websocket.js';
import { secondsToCron } from '../utils/shared.js';
import { createPerUserRunner } from './perUserRunner.js';

let syncTask: ReturnType<typeof cron.schedule> | null = null;

/** Sync one account: mail, then its drafts. */
async function syncAccount(userId: string): Promise<void> {
  // Status is per-account, not global. Broadcast, this lit up every connected
  // user's sync indicator whenever anybody synced, and leaked another
  // account's mailbox volume through the progress counts.
  wsEmitToUser(userId, 'sync:status', { syncing: true });

  try {
    try {
      const result = await emailService.syncFromGmail(userId);
      const hasChanges =
        result.synced > 0 ||
        result.customersCreated > 0 ||
        result.contactsCreated > 0 ||
        (result.labelsChanged ?? 0) > 0;
      if (hasChanges) {
        console.log(
          `[EmailSync] Synced ${result.synced} emails, ${result.labelsChanged ?? 0} label changes, ${result.customersCreated} companies, ${result.contactsCreated} contacts`
        );
        wsEmitToUser(userId, 'emails:synced', {
          synced: result.synced,
          labelsChanged: result.labelsChanged ?? 0,
          customersCreated: result.customersCreated,
          contactsCreated: result.contactsCreated,
        });
      }
      if (result.failed > 0) {
        console.warn(`[EmailSync] ${result.failed} message(s) failed to fetch and will be retried`);
      }
    } catch (err: any) {
      if (err?.status === 400 || err?.status === 403) {
        // Google not connected or permissions not granted — silently skip
      } else {
        console.error('[EmailSync] Sync failed:', err?.message || err);
      }
    }

    // Drafts are reconciled in their own try/catch so a drafts failure never
    // aborts the mail sync for the remaining users. In the steady state this
    // is a single `drafts.list` call — see draftService.syncDrafts.
    try {
      const drafts = await draftService.syncDrafts(userId);
      if (drafts.synced > 0 || drafts.removed > 0) {
        console.log(`[DraftSync] ${drafts.synced} drafts updated, ${drafts.removed} removed`);
      }
    } catch (err: any) {
      if (err?.status !== 400 && err?.status !== 403) {
        console.error('[DraftSync] Draft sync failed:', err?.message || err);
      }
    }
  } finally {
    // In a finally so an unexpected throw still clears this account's
    // indicator — otherwise one failure leaves the spinner running until the
    // page is reloaded.
    wsEmitToUser(userId, 'sync:status', { syncing: false });
  }
}

const runner = createPerUserRunner({
  label: 'EmailSync',
  concurrency: env.SYNC_MAX_CONCURRENT_ACCOUNTS,
  run: syncAccount,
});

export function startEmailSyncScheduler() {
  if (!env.EMAIL_SYNC_ENABLED) {
    console.log('[EmailSync] Background sync disabled (EMAIL_SYNC_ENABLED=false)');
    return;
  }

  const interval = Math.max(10, env.SYNC_INTERVAL_SECONDS);
  const cronExpr = secondsToCron(interval);

  console.log(`[EmailSync] Starting background sync every ${interval}s (cron: ${cronExpr})`);

  syncTask = cron.schedule(cronExpr, () => runner.runAll());

  // Run an initial sync 5 seconds after startup
  setTimeout(() => void runner.runAll(), 5000);
}

export function stopEmailSyncScheduler() {
  if (syncTask) {
    syncTask.stop();
    syncTask = null;
    console.log('[EmailSync] Background sync stopped');
  }
}

/**
 * Start a mail sync for one account immediately, without waiting for the next
 * tick. Used by the login callback so a new account does not sit empty for up to
 * a full interval while onboarding tells the user their mail is on its way.
 *
 * Returns once that account's sync finishes; callers that must not block should
 * not await it. Safe to call while a sync for the same account is running — the
 * runner's per-account guard makes it a no-op.
 */
export function syncAccountNow(userId: string): Promise<void> {
  return runner.runOne(userId);
}

/**
 * Run a manual sync for one account under the same guard the scheduler uses,
 * and hand back its result.
 *
 * `POST /emails/sync` used to call `emailService.syncFromGmail` directly, which
 * meant the "Sync now" button was invisible to the in-flight guard in both
 * directions: it could start while a scheduled sync was running, and a
 * scheduled tick could start while it was. Two syncs for one account race on
 * the same Gmail history cursor — the exact failure `perUserRunner` documents
 * itself as existing to prevent.
 *
 * Returns `{ ran: false }` when a sync is already going, so the caller can say
 * so rather than starting a second one.
 */
export function runManualSync<T>(userId: string, job: () => Promise<T>) {
  return runner.runExclusive(userId, job);
}

/** Whether any account is mid-sync. */
export function isSyncInProgress(): boolean {
  return runner.inFlightCount() > 0;
}

/** Whether this specific account is mid-sync. */
export function isSyncInProgressFor(userId: string): boolean {
  return runner.isInFlight(userId);
}
