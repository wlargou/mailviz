import { differenceInCalendarDays, format, formatDistanceStrict } from 'date-fns';

/**
 * A date as a list shows it: no year when it is this year's.
 *
 * "Sep 27, 2026" in September 2026 spends a third of the cell on the one part
 * the reader already knows. Another year's date keeps it, because then it is
 * the part that matters.
 */
export function shortDate(date: Date | string, { dayFirst = false, now = new Date() } = {}): string {
  const d = new Date(date);
  const sameYear = d.getFullYear() === now.getFullYear();
  if (dayFirst) return format(d, sameYear ? 'd MMM' : 'd MMM yyyy');
  return format(d, sameYear ? 'MMM d' : 'MMM d, yyyy');
}

/**
 * How far a deadline is, the way someone would say it: "in 2 days",
 * "tomorrow", "in 5 hours", "3 days late".
 *
 * Days are calendar days, not 24-hour spans — a deadline at 11:00 the day
 * after tomorrow is "in 2 days" at 23:00 tonight, which is how it feels.
 * Within today the hours are what count.
 */
export function timeLeft(deadline: Date | string, now = new Date()): string {
  const d = new Date(deadline);
  if (d.getTime() < now.getTime()) return `${formatDistanceStrict(d, now, { roundingMethod: 'floor' })} late`;
  const days = differenceInCalendarDays(d, now);
  if (days === 0) return `in ${formatDistanceStrict(d, now, { roundingMethod: 'ceil' })}`;
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
