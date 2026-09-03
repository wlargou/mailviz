import { Tag } from '@carbon/react';
import { WarningAlt } from '@carbon/icons-react';

/** After this long the sweep stops retrying — mirrors MAX_AGE_MS on the server. */
const GAVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

interface PendingPushTagProps {
  /** `CalendarEvent.pendingSince` — null when the event is in Google. */
  pendingSince: string | null;
  size?: 'sm' | 'md';
}

/**
 * Says an event has not reached Google Calendar.
 *
 * The save-time toast already says this once, but it is gone on the next
 * render — and until this existed, a diverged row was indistinguishable from a
 * synced one after a reload. That mattered because the row is also the one the
 * sync now refuses to overwrite: it can stay different from Google
 * indefinitely, so the difference has to be visible.
 *
 * Two states, using the same vocabulary as the scheduled-send tags: blue while
 * it is still being retried, red once it is not.
 */
export function PendingPushTag({ pendingSince, size = 'sm' }: PendingPushTagProps) {
  if (!pendingSince) return null;

  const age = Date.now() - new Date(pendingSince).getTime();
  const gaveUp = age >= GAVE_UP_AFTER_MS;

  return (
    <span className="pending-push">
      <Tag size={size} type={gaveUp ? 'red' : 'blue'} renderIcon={WarningAlt}>
        {gaveUp ? 'Not in Google Calendar — no longer retrying' : 'Not in Google Calendar'}
      </Tag>
      {/*
        Visible, not a tooltip. Carbon's `Tag` spends its `title` attribute on
        its own dismiss control, but the better reason is that a terminal state
        with a hidden remedy is just blame — and both routes back are real:
        reconnecting clears the marker through `skipped/not-connected`, and
        re-saving resets `pendingSince`, which puts the row back inside the
        retry window.
      */}
      {gaveUp && (
        <span className="pending-push__hint">
          Reconnect Google in Settings, or open and save the event again to retry.
        </span>
      )}
    </span>
  );
}
