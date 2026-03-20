import * as cron from 'node-cron';
import { emailService } from '../services/emailService.js';
import { env } from '../config/env.js';
import { wsEmit } from '../websocket.js';

let isSyncing = false;
let syncTask: ReturnType<typeof cron.schedule> | null = null;

async function runSync() {
  if (isSyncing) {
    console.log('[EmailSync] Skipping — sync already in progress');
    return;
  }

  isSyncing = true;
  wsEmit('sync:status', { syncing: true });
  try {
    const result = await emailService.syncFromGmail();
    const hasChanges = result.synced > 0 || result.customersCreated > 0 || result.contactsCreated > 0 || (result.labelsChanged ?? 0) > 0;
    if (hasChanges) {
      console.log(
        `[EmailSync] Synced ${result.synced} emails, ${result.labelsChanged ?? 0} label changes, ${result.customersCreated} companies, ${result.contactsCreated} contacts`
      );
      wsEmit('emails:synced', {
        synced: result.synced,
        labelsChanged: result.labelsChanged ?? 0,
        customersCreated: result.customersCreated,
        contactsCreated: result.contactsCreated,
      });
    }
  } catch (err: any) {
    // Don't crash the scheduler on errors
    if (err?.status === 400 || err?.status === 403) {
      // Google not connected or permissions not granted — silently skip
      // User needs to reconnect from Settings
    } else {
      console.error('[EmailSync] Sync failed:', err?.message || err);
    }
  } finally {
    isSyncing = false;
    wsEmit('sync:status', { syncing: false });
  }
}

/** Convert seconds to a cron expression. Supports 10s–3600s. */
function secondsToCron(seconds: number): string {
  if (seconds < 60) {
    // Run every N seconds
    return `*/${seconds} * * * * *`;
  }
  const minutes = Math.round(seconds / 60);
  return `*/${minutes} * * * *`;
}

export function startEmailSyncScheduler() {
  if (!env.EMAIL_SYNC_ENABLED) {
    console.log('[EmailSync] Background sync disabled (EMAIL_SYNC_ENABLED=false)');
    return;
  }

  const interval = Math.max(10, env.SYNC_INTERVAL_SECONDS);
  const cronExpr = secondsToCron(interval);

  console.log(`[EmailSync] Starting background sync every ${interval}s (cron: ${cronExpr})`);

  syncTask = cron.schedule(cronExpr, runSync);

  // Run an initial sync 5 seconds after startup
  setTimeout(runSync, 5000);
}

export function stopEmailSyncScheduler() {
  if (syncTask) {
    syncTask.stop();
    syncTask = null;
    console.log('[EmailSync] Background sync stopped');
  }
}

/** Expose syncing status for the API */
export function isSyncInProgress(): boolean {
  return isSyncing;
}
