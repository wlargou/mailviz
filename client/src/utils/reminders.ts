/**
 * Reminder presets, relative to a task's due date.
 *
 * A reminder is an absolute instant on the row (`remindAt`); the form offers
 * it as "the morning of", "the day before", "a week before" so nobody has to
 * type a time. Nine o'clock in the browser's zone: the app stores the user's
 * timezone server-side, and the browser is where the user is.
 */
export type ReminderPresetId = 'none' | 'due-morning' | 'day-before' | 'week-before';

export interface ReminderOption {
  id: ReminderPresetId;
  label: string;
}

const REMINDER_HOUR = 9;

export const REMINDER_OPTIONS: ReminderOption[] = [
  { id: 'none', label: 'No reminder' },
  { id: 'due-morning', label: 'On the due date, 9:00' },
  { id: 'day-before', label: 'The day before, 9:00' },
  { id: 'week-before', label: 'A week before, 9:00' },
];

function atNine(date: Date, daysBefore: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysBefore, REMINDER_HOUR, 0, 0, 0);
  return d;
}

/** The instant a preset means for a due date; null for "none" or no due date. */
export function reminderFor(preset: ReminderPresetId, dueDate: Date | null): Date | null {
  if (!dueDate || preset === 'none') return null;
  switch (preset) {
    case 'due-morning':
      return atNine(dueDate, 0);
    case 'day-before':
      return atNine(dueDate, 1);
    case 'week-before':
      return atNine(dueDate, 7);
    default:
      return null;
  }
}

/**
 * Which preset a stored reminder corresponds to, or null when it is some
 * other instant (set through the API) — shown as is rather than snapped.
 */
export function reminderPreset(remindAt: string | null | undefined, dueDate: Date | null): ReminderPresetId | null {
  if (!remindAt) return 'none';
  const at = new Date(remindAt).getTime();
  for (const option of REMINDER_OPTIONS) {
    if (option.id === 'none') continue;
    if (reminderFor(option.id, dueDate)?.getTime() === at) return option.id;
  }
  return null;
}
