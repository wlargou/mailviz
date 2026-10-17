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
 */
export function startSchedulers(): void {
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
