import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SnoozeModal } from './SnoozeModal';

/**
 * The snooze / follow-up picker.
 *
 * What is worth locking down here is not the layout but the arithmetic: every
 * preset is a relative expression ("tomorrow morning") that has to resolve to a
 * concrete instant in the future, and the two kinds share one form. A preset
 * that quietly resolves to a time in the past is rejected by the server with an
 * error the user cannot act on, so it is caught here instead.
 *
 * The clock is frozen so "next Monday" is a fact rather than a coin toss about
 * which day the suite happens to run on.
 */

const FROZEN_NOW = new Date('2026-08-19T14:20:00');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(overrides: Partial<Parameters<typeof SnoozeModal>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <SnoozeModal
      open
      subject="Quarterly review"
      onSubmit={onSubmit}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onSubmit, onClose, user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) };
}

describe('SnoozeModal', () => {
  it('offers snooze presets that resolve to a concrete future time', () => {
    setup();

    expect(screen.getByText('Later today')).toBeInTheDocument();
    // 14:20 + 3h, floored to the hour.
    expect(screen.getByText('Wed 19 Aug, 5:00 PM')).toBeInTheDocument();
    expect(screen.getByText('Thu 20 Aug, 8:00 AM')).toBeInTheDocument();
    // Wednesday's "next week" is the following Monday, not tomorrow.
    expect(screen.getByText('Mon 24 Aug, 8:00 AM')).toBeInTheDocument();
  });

  it('submits the selected preset as an absolute date', async () => {
    const { onSubmit, user } = setup();

    await user.click(screen.getByRole('button', { name: 'Snooze' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [kind, remindAt] = onSubmit.mock.calls[0];
    expect(kind).toBe('snooze');
    expect(remindAt).toBeInstanceOf(Date);
    expect(remindAt.getTime()).toBeGreaterThan(FROZEN_NOW.getTime());
    expect(remindAt.getHours()).toBe(17);
  });

  /**
   * The two kinds are not interchangeable, and the difference — that a
   * follow-up cancels itself when a reply arrives — is invisible unless the
   * form says so.
   */
  it('switches to the follow-up kind, its own presets, and explains the difference', async () => {
    const { onSubmit, user } = setup();

    expect(screen.getByText(/comes back, unread/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Follow up' }));

    expect(screen.getByText(/unless somebody replies first/)).toBeInTheDocument();
    expect(screen.getByText('In two days')).toBeInTheDocument();
    expect(screen.queryByText('Later today')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(onSubmit.mock.calls[0][0]).toBe('follow_up');
  });

  it('asks for a date before submitting a custom time', async () => {
    const { onSubmit, user } = setup();

    await user.click(screen.getByLabelText('Pick a date and time'));
    await user.click(screen.getByRole('button', { name: 'Snooze' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a date and a time')).toBeInTheDocument();
  });
});
