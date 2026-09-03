import { prisma } from '../lib/prisma.js';
import { calendarService, settlePending, pushExtrasFromRow } from '../services/calendarService.js';

/**
 * Retry the local calendar changes that never reached Google.
 *
 * `pendingSince` stops the sync reverting those rows, but on its own it only
 * freezes them: a push that failed to a thirty-second Google blip would stay
 * pending until the user happened to re-save. This is the other half.
 *
 * There is no attempt counter and no stored error, deliberately. A push here is
 * idempotent reconciliation — `events.update` with the row's current contents —
 * so abandoning after N leaves the calendar permanently diverged, which is the
 * original bug with extra steps. `classifyGoogleError` already answers the
 * give-up question per failure, and a timestamp answers ordering, backoff and
 * the bound by itself.
 */

/**
 * Youngest a row may be before the sweep touches it — comfortably longer than
 * the request that is still pushing it.
 */
const MIN_AGE_MS = 60_000;

/**
 * Oldest. Past this the row stays pending — still protected from the sync,
 * still shown as diverged — but is no longer retried.
 *
 * It is never cleared on a timer. Clearing would let the next sync destroy the
 * edit, which is the bug this exists to prevent, just delayed.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Pushes per account per tick. */
const BATCH = 20;

export async function sweepPendingPushes(userId: string) {
  const now = Date.now();
  const rows = await prisma.calendarEvent.findMany({
    where: {
      userId,
      pendingSince: { gte: new Date(now - MAX_AGE_MS), lt: new Date(now - MIN_AGE_MS) },
    },
    // Oldest first: the longest-diverged row wins the budget.
    orderBy: { pendingSince: 'asc' },
    take: BATCH,
  });

  let attempted = 0;
  let cleared = 0;

  for (const row of rows) {
    const push = await calendarService.pushToGoogle(
      row.id,
      // A pending row with no Google id is a create that never landed.
      row.googleEventId ? 'update' : 'create',
      userId,
      {
        ...pushExtrasFromRow(row),
        // The user chose a notification setting when they saved, and it was not
        // stored. Silent is the only choice that cannot violate it — Google's
        // own UI still shows the change to anyone who looks.
        sendUpdates: 'none',
      }
    );

    attempted++;
    await settlePending(row.id, userId, push);
    if (push.status === 'pushed') cleared++;
  }

  return { attempted, cleared };
}
