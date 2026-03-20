import * as cron from 'node-cron';
import { emailService } from '../services/emailService.js';
import { env } from '../config/env.js';
import { wsEmit } from '../websocket.js';
import { secondsToCron } from '../utils/shared.js';
import { prisma } from '../lib/prisma.js';

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
    // S1: Sync for ALL users with GoogleAuth records
    const authRecords = await prisma.googleAuth.findMany({ select: { userId: true } });
    for (const { userId } of authRecords) {
      try {
        const result = await emailService.syncFromGmail(userId);
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
        if (err?.status === 400 || err?.status === 403) {
          // Google not connected or permissions not granted — silently skip
        } else {
          console.error('[EmailSync] Sync failed:', err?.message || err);
        }
      }
    }
  } catch (err: any) {
    console.error('[EmailSync] Scheduler error:', err?.message || err);
  } finally {
    isSyncing = false;
    wsEmit('sync:status', { syncing: false });
  }
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
