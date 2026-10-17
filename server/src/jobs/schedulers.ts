import { env } from '../config/env.js';
import { startEmailSyncScheduler, stopEmailSyncScheduler } from './emailSyncScheduler.js';
import { startCalendarSyncScheduler, stopCalendarSyncScheduler } from './calendarSyncScheduler.js';
import { startScheduledSendScheduler, stopScheduledSendScheduler } from './scheduledSendScheduler.js';
import { startNotificationScheduler, stopNotificationScheduler } from './notificationScheduler.js';
import { startSnoozeScheduler, stopSnoozeScheduler } from './snoozeScheduler.js';

/**
 * Every background job this process runs, started and stopped as one.
 *
 * One list rather than five calls in `index.ts`, so a sixth scheduler cannot be
 * started there and forgotten by the shutdown path, or the other way round.
 *
 * `RUN_SCHEDULERS=false` starts none of them. Two processes running them
 * against one database is not safe: the syncs race on each account's history
 * cursor and calendar rows, and notifications are raised twice. Scheduled send
 * claims its rows and survives it, but the rest do not, so only one process
 * may run them — on a cluster, one replica; on staging, none.
 */
export function startSchedulers(): void {
  if (!env.RUN_SCHEDULERS) {
    console.log('[Schedulers] RUN_SCHEDULERS=false: no background jobs in this process');
    return;
  }
  startEmailSyncScheduler();
  startCalendarSyncScheduler();
  startScheduledSendScheduler();
  startNotificationScheduler();
  startSnoozeScheduler();
}

export function stopSchedulers(): void {
  stopEmailSyncScheduler();
  stopCalendarSyncScheduler();
  stopScheduledSendScheduler();
  stopNotificationScheduler();
  stopSnoozeScheduler();
}
