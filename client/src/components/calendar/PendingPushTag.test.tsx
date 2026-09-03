import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingPushTag } from './PendingPushTag';

/**
 * The visible half of the pending-push work.
 *
 * Without it a row that never reached Google is indistinguishable from a synced
 * one after a reload — and since the sync now refuses to overwrite that row, it
 * can stay different from Google indefinitely. An invisible divergence that is
 * also protected is worse than one that gets reverted, because nothing ever
 * tells the user to act.
 */

const HOURS = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe('PendingPushTag', () => {
  it('renders nothing for an event that reached Google', () => {
    const { container } = render(<PendingPushTag pendingSince={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says the change is still being retried while it is', () => {
    render(<PendingPushTag pendingSince={ago(2 * HOURS)} />);

    expect(screen.getByText('Not in Google Calendar')).toBeInTheDocument();
    expect(screen.queryByText(/no longer retrying/)).not.toBeInTheDocument();
    // No remedy offered while it is still retrying on its own.
    expect(screen.queryByText(/Reconnect Google/)).not.toBeInTheDocument();
  });

  it('says it has given up once the sweep has', () => {
    // The wording must change with the server's behaviour, or it tells the
    // user to wait for a retry that is never coming.
    render(<PendingPushTag pendingSince={ago(25 * HOURS)} />);

    expect(screen.getByText('Not in Google Calendar — no longer retrying')).toBeInTheDocument();
  });

  it('names the two things that actually fix it', () => {
    // A terminal state with no remedy is just blame. Both routes back are real:
    // reconnecting clears it via `skipped/not-connected`, and re-saving resets
    // pendingSince, which puts the row back inside the retry window.
    render(<PendingPushTag pendingSince={ago(25 * HOURS)} />);

    // Visible text, not a tooltip — Carbon's Tag spends `title` on its own
    // dismiss control, and a remedy nobody can see is not a remedy.
    expect(screen.getByText(/Reconnect Google in Settings/)).toBeInTheDocument();
    expect(screen.getByText(/save the event again/)).toBeInTheDocument();
  });
});
