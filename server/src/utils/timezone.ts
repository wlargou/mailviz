/**
 * Calendar-day arithmetic in a user's own timezone.
 *
 * Everything date-shaped in this app was computed with `new Date(y, m, d)`,
 * which uses the *server's* zone. Railway runs UTC, so "today" on the dashboard
 * began at UTC midnight — 2am for a user in Paris, and still yesterday for one
 * in California. The same assumption sent all-day events to Google with a
 * UTC-derived date, which lands them a day early for anyone west of UTC.
 *
 * Implemented on `Intl` rather than a dependency. Node ships full ICU, and the
 * whole of what is needed here is "what wall-clock does this instant show in
 * that zone" — which `formatToParts` answers exactly, DST included, from the
 * same tz database a library would wrap.
 */

/**
 * How far `timeZone` is ahead of UTC at this instant, in milliseconds.
 *
 * Formats the instant as wall-clock in the target zone, then reads those
 * numbers back as if they were UTC. The difference between that and the real
 * instant IS the offset — which is why this works across DST without a table:
 * the formatter already applied whichever rule was in force.
 */
export function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);

  const f = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(f('year'), f('month') - 1, f('day'), f('hour'), f('minute'), f('second'));
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The calendar date `at` falls on in `timeZone`, as { year, month, day }. */
export function calendarDateInZone(at: Date, timeZone: string) {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  })
    .format(at)
    .split('-')
    .map(Number);
  return { year, month, day };
}

/** `at`'s calendar date in `timeZone` as `yyyy-MM-dd` — Google's all-day format. */
export function formatDateInZone(at: Date, timeZone: string): string {
  const { year, month, day } = calendarDateInZone(at, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The instant at which the given wall-clock midnight occurs in `timeZone`.
 *
 * Solved by iteration rather than algebra: the offset to subtract depends on
 * the instant, and the instant depends on the offset. Two passes settle it —
 * the first lands within an hour, the second corrects when that hour happened
 * to straddle a DST transition.
 *
 * On a spring-forward day 00:00 exists, so this is well-defined everywhere DST
 * shifts at 1am or later; zones that skip midnight itself resolve to the first
 * instant of the day, which is the useful answer for a day boundary.
 */
function instantOfLocalMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const wallClock = Date.UTC(year, month - 1, day);
  let guess = wallClock;
  for (let i = 0; i < 2; i++) {
    guess = wallClock - zoneOffsetMs(new Date(guess), timeZone);
  }
  return new Date(guess);
}

/** Midnight, in `timeZone`, of the day `at` falls on. */
export function startOfDayInZone(at: Date, timeZone: string): Date {
  const { year, month, day } = calendarDateInZone(at, timeZone);
  return instantOfLocalMidnight(year, month, day, timeZone);
}

/**
 * Midnight `days` calendar days after the day `at` falls on, in `timeZone`.
 *
 * Whole calendar days, not multiples of 24 hours: a week containing a DST
 * change is 167 or 169 hours long, and adding 7 * 86400000 to a Monday
 * midnight lands at 23:00 the previous Sunday or 01:00 Monday.
 */
export function addDaysInZone(at: Date, days: number, timeZone: string): Date {
  const { year, month, day } = calendarDateInZone(at, timeZone);
  return instantOfLocalMidnight(year, month, day + days, timeZone);
}

/**
 * Midnight on the Monday of the week `at` falls in, in `timeZone`.
 *
 * Monday because that is what the dashboard already assumed, and the client
 * renders its week views the same way.
 */
export function startOfWeekInZone(at: Date, timeZone: string): Date {
  const midnight = startOfDayInZone(at, timeZone);
  // getUTCDay on a local-midnight instant would read the wrong day near the
  // date line, so ask the formatter which weekday it is in the zone itself.
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(midnight);
  const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday);
  return addDaysInZone(midnight, -index, timeZone);
}

/**
 * A timezone that is safe to hand to `Intl`, defaulting to UTC.
 *
 * The column is free text written by a client, so an unknown or malformed zone
 * has to degrade rather than throw: a bad value in one user's row must not turn
 * their dashboard into a 500. UTC is the same behaviour the app had before
 * timezones existed, which makes the fallback a return to the old state rather
 * than a new failure mode.
 */
export function resolveTimeZone(value: string | null | undefined): string {
  if (!value) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return value;
  } catch {
    console.warn(`[Timezone] Ignoring unknown timezone ${JSON.stringify(value)}; using UTC`);
    return 'UTC';
  }
}
