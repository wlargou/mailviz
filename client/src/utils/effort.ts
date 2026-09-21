/**
 * Estimated effort, as the form offers it.
 *
 * The row stores minutes; the form offers nine fixed steps on a slider so
 * nobody has to decide between 25 and 30. A stored value that is not one of
 * the steps (an API caller wrote 45) lands on "None" in the form, and saving
 * without touching the slider must not then erase it — the detail panel
 * compares against the snapped value for exactly that reason.
 */
export const EFFORT_STEPS = [0, 5, 10, 15, 30, 60, 120, 240, 480];

export const EFFORT_LABELS: Record<number, string> = {
  0: 'None', 5: '5 min', 10: '10 min', 15: '15 min',
  30: '30 min', 60: '1 hour', 120: '2 hours', 240: '4 hours', 480: '1 day',
};

export function minutesToStepIndex(minutes: number | null | undefined): number {
  if (!minutes) return 0;
  const idx = EFFORT_STEPS.indexOf(minutes);
  return idx >= 0 ? idx : 0;
}

export function stepIndexToMinutes(index: number): number | null {
  const val = EFFORT_STEPS[index] ?? 0;
  return val === 0 ? null : val;
}

export function effortLabel(index: number): string {
  return EFFORT_LABELS[EFFORT_STEPS[index]] || 'None';
}
