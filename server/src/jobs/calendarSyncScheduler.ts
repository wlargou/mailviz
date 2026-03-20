import * as cron from 'node-cron';
import { calendarService } from '../services/calendarService.js';
import { env } from '../config/env.js';
import { wsEmit } from '../websocket.js';
import { secondsToCron } from '../utils/shared.js';
import { prisma } from '../lib/prisma.js';

let isSyncing = false;
let syncTask: ReturnType<typeof cron.schedule> | null = null;

async function runSync() {
  if (isSyncing) {
    console.log('[CalendarSync] Skipping — sync already in progress');
    return;
  }

  isSyncing = true;
  wsEmit('calendar:sync:status', { syncing: true });
  try {
    // S1: Sync for ALL users with GoogleAuth records
    const authRecords = await prisma.googleAuth.findMany({ select: { userId: true } });
    for (const { userId } of authRecords) {
      try {
        const result = await calendarService.syncFromGoogle(false, userId);
        const hasChanges = result.synced > 0 || result.customersCreated > 0 || result.contactsCreated > 0;
        if (hasChanges) {
          console.log(
            `[CalendarSync] Synced ${result.synced} events, ${result.customersCreated} companies, ${result.contactsCreated} contacts`
          );
          wsEmit('calendar:synced', {
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
      }
    }
  } catch (err: any) {
    console.error('[CalendarSync] Scheduler error:', err?.message || err);
  } finally {
    isSyncing = false;
    wsEmit('calendar:sync:status', { syncing: false });
  }
}

export function startCalendarSyncScheduler() {
  if (!env.CALENDAR_SYNC_ENABLED) {
    console.log('[CalendarSync] Background sync disabled (CALENDAR_SYNC_ENABLED=false)');
    return;
  }

  const interval = Math.max(10, env.CALENDAR_SYNC_INTERVAL_SECONDS);
  const cronExpr = secondsToCron(interval);

  console.log(`[CalendarSync] Starting background sync every ${interval}s (cron: ${cronExpr})`);

  syncTask = cron.schedule(cronExpr, runSync);

  // Run an initial sync 10 seconds after startup (staggered from email sync at 5s)
  setTimeout(runSync, 10000);
}

export function stopCalendarSyncScheduler() {
  if (syncTask) {
    syncTask.stop();
    syncTask = null;
    console.log('[CalendarSync] Background sync stopped');
  }
}

/** Expose syncing status for the API */
export function isCalendarSyncInProgress(): boolean {
  return isSyncing;
}
