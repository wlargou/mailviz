/**
 * Which day the week starts on, for every calendar surface.
 *
 * This exists because it was two numbers. `calendarStore.getDateRange` fetched
 * with `weekStartsOn: 0` (Sunday) while `CalendarWeekView` and
 * `CalendarMonthView` both rendered with `weekStartsOn: 1` (Monday), so the
 * window that was fetched and the grid that was drawn covered different days:
 * the rendered Sunday sat outside the fetched range and was always empty, and a
 * fetched Sunday was never drawn. Nothing errored — the events simply were not
 * there.
 *
 * A single exported constant is the fix. Anything that computes a week boundary
 * imports this, so the fetch and the render cannot disagree again. If the week
 * ever becomes a user preference, this is the one place that has to learn about
 * it.
 *
 * `1` is Monday, matching date-fns' convention and how the grid has always been
 * drawn.
 */
export const WEEK_STARTS_ON = 1 as const;
