import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimezoneSetting } from './TimezoneSetting';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../store/authStore';

/**
 * The manual override for a detected timezone.
 *
 * Detection covers the common case, so what this has to get right is the
 * uncommon one: an account whose stored zone is wrong or absent. The value
 * drives every day and week boundary the server computes, so the two things
 * worth pinning are that a null reads as UTC rather than as "unset and
 * therefore fine", and that a failed save does not leave the UI claiming a
 * zone the server never stored.
 */

vi.mock('../../api/auth', () => ({
  authApi: { updateTimezone: vi.fn(), getMe: vi.fn(), logout: vi.fn() },
}));

const initialAuthState = useAuthStore.getState();

function signedInWith(timezone: string | null) {
  useAuthStore.setState({
    ...initialAuthState,
    user: { id: 'u1', email: 'a@b.test', name: 'A', avatarUrl: null, timezone },
    isAuthenticated: true,
    isLoading: false,
    fetchUser: vi.fn().mockResolvedValue(undefined),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.updateTimezone).mockResolvedValue({} as never);
});

describe('TimezoneSetting', () => {
  it('says dates are in UTC when no zone is stored', async () => {
    // The pre-column state of every account. "No timezone set" has to read as
    // a consequence, not as a blank field.
    signedInWith(null);

    render(<TimezoneSetting />);

    expect(await screen.findByText(/calculated in UTC/i)).toBeInTheDocument();
  });

  it('names the stored zone when there is one', async () => {
    signedInWith('Europe/Paris');

    render(<TimezoneSetting />);

    expect(await screen.findByText(/calculated in Europe\/Paris/i)).toBeInTheDocument();
  });

  it('saves a zone chosen from the list', async () => {
    const user = userEvent.setup();
    signedInWith(null);
    render(<TimezoneSetting />);

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'Europe/Par');
    await user.click(await screen.findByText('Europe/Paris'));

    await waitFor(() => expect(authApi.updateTimezone).toHaveBeenCalledWith('Europe/Paris'));
  });

  it('offers the browser zone when it differs from the stored one', async () => {
    signedInWith('Pacific/Kiritimati');

    render(<TimezoneSetting />);

    expect(await screen.findByRole('button', { name: /use this browser/i })).toBeInTheDocument();
  });

  it('does not offer the browser zone when it is already stored', async () => {
    // Otherwise the button is permanent furniture that does nothing.
    signedInWith(Intl.DateTimeFormat().resolvedOptions().timeZone);

    render(<TimezoneSetting />);

    expect(screen.queryByRole('button', { name: /use this browser/i })).toBeNull();
  });

  it('reports a failed save instead of pretending it worked', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.updateTimezone).mockRejectedValue(new Error('offline'));
    signedInWith('Pacific/Kiritimati');
    render(<TimezoneSetting />);

    await user.click(await screen.findByRole('button', { name: /use this browser/i }));

    expect(await screen.findByText(/could not save timezone/i)).toBeInTheDocument();
  });
});
