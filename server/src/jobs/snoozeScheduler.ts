import * as cron from 'node-cron';
import { snoozeService } from '../services/snoozeService.js';

/**
 * Wakes snoozed threads and raises follow-up reminders.
 *
 * Every 30 seconds, matching `scheduledSendScheduler` — the user picked a
 * minute, so half a minute of slack is the right resolution and a cheaper poll
 * would not be noticed.
 *
 * Each tick does two things, in this order:
 *
 *  1. Clear follow-ups whose reply has already arrived. Cheap (local queries
 *     only) and it keeps the pending list honest between deadlines.
 *  2. Fire what has come due, oldest first, capped at
 *     `MAX_REMINDERS_PER_TICK`. The cap is the answer to "the server was down
 *     over the weekend": a backlog of overdue snoozes drains at a steady rate
 *     instead of arriving as one burst of Gmail writes against the per-user
 *     rate limiter and one wall of notifications. Nothing is dropped — the rows
 *     stay armed and the next tick takes the next batch.
 */

let task: ReturnType<typeof cron.schedule> | null = null;
let isRunning = false;

async function runReminderCheck() {
  if (isRunning) {
    console.log('[Snooze] Skipping — reminder check already in progress');
    return;
  }
  isRunning = true;
  try {
    const cancelled = await snoozeService.cancelRepliedFollowUps();
    if (cancelled > 0) console.log(`[Snooze] Cleared ${cancelled} follow-ups that got a reply`);

    const fired = await snoozeService.processDue();
    if (fired > 0) console.log(`[Snooze] Fired ${fired} reminders`);
  } catch (err: unknown) {
    console.error('[Snooze] Scheduler error:', err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}

export function startSnoozeScheduler() {
  console.log('[Snooze] Starting reminder check every 30s');
  task = cron.schedule('*/30 * * * * *', runReminderCheck);

  // Catch anything that came due while the process was down, but not in the
  // same breath as startup — the email sync's own initial pass fires at 5s.
  setTimeout(runReminderCheck, 15_000);
}

export function stopSnoozeScheduler() {
  if (task) {
    task.stop();
    task = null;
    console.log('[Snooze] Reminder scheduler stopped');
  }
}
