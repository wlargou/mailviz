import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteAccountModal } from './DeleteAccountModal';
import type { AccountDeletionSummary } from '../../api/auth';

/**
 * The confirmation for the only irreversible action in the product.
 *
 * The typed-address check is a UX guard, not a security control — the server
 * re-checks it and returns 400 on a mismatch. What is worth testing here is
 * that the guard cannot be bypassed by the obvious accidents (empty field, a
 * near-miss address, counts not loaded yet), and that the dialog tells the
 * truth about what survives. A user who believes deleting their account will
 * destroy a colleague's assigned task is being misinformed by this component.
 */

const SUMMARY: AccountDeletionSummary = {
  email: 'ada@example.com',
  emails: 25431,
  calendarEvents: 812,
  companies: 3014,
  contacts: 12990,
  tasks: 7,
  deals: 2,
  drafts: 4,
  scheduledEmails: 1,
  templates: 3,
  labels: 5,
  assignedByOthers: 2,
  sharesGiven: 1,
  googleConnected: true,
};

const handlers = {
  onConfirmTextChange: vi.fn(),
  onClose: vi.fn(),
  onConfirm: vi.fn(),
};

function renderModal(overrides: Partial<React.ComponentProps<typeof DeleteAccountModal>> = {}) {
  return render(
    <DeleteAccountModal
      open
      summary={SUMMARY}
      confirmText=""
      deleting={false}
      {...handlers}
      {...overrides}
    />
  );
}

// The label flips to "Deleting…" while the request is in flight, so the query
// has to match either state — otherwise the in-flight case fails on not finding
// the button rather than on the assertion it is making.
const deleteButton = () => screen.getByRole('button', { name: /Delete my account|Deleting/i });

beforeEach(() => vi.clearAllMocks());

describe('DeleteAccountModal — the confirmation guard', () => {
  it('keeps the button disabled until the address matches exactly', async () => {
    const { rerender } = renderModal({ confirmText: '' });
    expect(deleteButton()).toBeDisabled();

    // A near miss must not pass — this is the case the guard exists for.
    rerender(
      <DeleteAccountModal
        open
        summary={SUMMARY}
        confirmText="ada@example.co"
        deleting={false}
        {...handlers}
      />
    );
    expect(deleteButton()).toBeDisabled();

    rerender(
      <DeleteAccountModal
        open
        summary={SUMMARY}
        confirmText="ada@example.com"
        deleting={false}
        {...handlers}
      />
    );
    expect(deleteButton()).toBeEnabled();
  });

  it('accepts the address with different case or stray whitespace', () => {
    // Copy-pasting an address commonly picks up a trailing space, and an
    // address is not case-sensitive. Failing on either would read as a bug.
    renderModal({ confirmText: '  ADA@Example.COM  ' });

    expect(deleteButton()).toBeEnabled();
  });

  it('stays disabled while the counts are still loading', () => {
    // Without the summary there is no address to match, so a confirm here would
    // be agreeing to something the user has not been shown.
    renderModal({ summary: null, confirmText: 'ada@example.com' });

    expect(deleteButton()).toBeDisabled();
    expect(screen.getByText(/Loading what this will remove/i)).toBeInTheDocument();
  });

  it('stays disabled while the delete is in flight', () => {
    renderModal({ confirmText: 'ada@example.com', deleting: true });

    expect(deleteButton()).toBeDisabled();
  });

  it('reports typing up to the parent rather than holding its own copy', async () => {
    const user = userEvent.setup();
    renderModal({ confirmText: '' });

    await user.type(screen.getByLabelText(/Type ada@example.com to confirm/i), 'a');

    expect(handlers.onConfirmTextChange).toHaveBeenCalledWith('a');
  });

  it('confirms only when the button is actually pressed', async () => {
    const user = userEvent.setup();
    renderModal({ confirmText: 'ada@example.com' });

    expect(handlers.onConfirm).not.toHaveBeenCalled();
    await user.click(deleteButton());

    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('refuses to close itself mid-delete', async () => {
    const user = userEvent.setup();
    renderModal({ confirmText: 'ada@example.com', deleting: true });

    await user.click(screen.getByRole('button', { name: /Cancel/i }));

    // Closing here would leave the user on a page whose account is being
    // deleted underneath them.
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('closes on cancel when nothing is in flight', async () => {
    const user = userEvent.setup();
    renderModal({ confirmText: '' });

    await user.click(screen.getByRole('button', { name: /Cancel/i }));

    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DeleteAccountModal — what it tells the user', () => {
  it('shows the real counts, formatted, not a generic warning', () => {
    renderModal();

    // "25,431 emails" is a number people read; "all your data" is a phrase they
    // click through. The grouping separator is the whole point of using it.
    expect(screen.getByText(/25,431 emails/)).toBeInTheDocument();
    expect(screen.getByText(/12,990 contacts/)).toBeInTheDocument();
    expect(screen.getByText(/812 calendar events/)).toBeInTheDocument();
  });

  it("says that other people's assigned work survives", () => {
    renderModal();

    expect(
      screen.getByText(/2 tasks assigned to you but owned by someone else are kept/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/originals stay with their owners/i)).toBeInTheDocument();
  });

  it('reads correctly for a single task rather than "1 tasks ... are kept"', () => {
    renderModal({ summary: { ...SUMMARY, assignedByOthers: 1, sharesGiven: 1 } });

    expect(screen.getByText(/1 task assigned to you but owned by someone else is kept/i))
      .toBeInTheDocument();
    expect(screen.getByText(/1 item you shared/i)).toBeInTheDocument();
  });

  it('omits the reassurance entirely when there is nothing to reassure about', () => {
    renderModal({ summary: { ...SUMMARY, assignedByOthers: 0, sharesGiven: 0 } });

    expect(screen.queryByText(/assigned to you but owned by someone else/i)).toBeNull();
    expect(screen.queryByText(/originals stay with their owners/i)).toBeNull();
  });

  it('mentions the Google grant only when one is connected', () => {
    renderModal();
    expect(screen.getByText(/Your Google connection/i)).toBeInTheDocument();

    renderModal({ summary: { ...SUMMARY, googleConnected: false } });
    // Two modals are now rendered; neither should claim a connection exists.
    expect(screen.queryAllByText(/Your Google connection/i)).toHaveLength(1);
  });
});
