import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingGate } from './OnboardingGate';
import { onboardingApi } from '../../api/onboarding';
import type { OnboardingStatus } from '../../types/onboarding';

/**
 * The gate decides whether an account is interrupted on login, so the properties
 * worth locking down are about restraint: an established account must see
 * nothing, a failed status call must not produce an error screen for a tour
 * nobody asked for, and dismissing must be recorded so it does not come back
 * every single login.
 */

vi.mock('../../api/onboarding', () => ({
  onboardingApi: {
    getStatus: vi.fn(),
    complete: vi.fn(),
    seedTaskStatuses: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('../../api/dealPartners', () => ({
  dealPartnersApi: { create: vi.fn() },
}));

vi.mock('../../api/auth', () => ({
  authApi: { updateSignature: vi.fn() },
}));

const addNotification = vi.fn();
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: (state: { addNotification: typeof addNotification }) => unknown) =>
    selector({ addNotification }),
}));

function status(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
    completedAt: null,
    needsOnboarding: true,
    alreadyUpAndRunning: false,
    steps: {
      googleConnected: true,
      taskStatusCount: 0,
      dealPartnerCount: 0,
      hasSignature: false,
      hasDisplayName: true,
      emailCount: 0,
    },
    blocking: ['taskStatuses', 'dealPartners'],
    ...overrides,
  };
}

function mockStatus(value: OnboardingStatus) {
  vi.mocked(onboardingApi.getStatus).mockResolvedValue({ data: { data: value } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(onboardingApi.complete).mockResolvedValue({} as never);
  vi.mocked(onboardingApi.seedTaskStatuses).mockResolvedValue({
    data: { data: { created: 3, skipped: false } },
  } as never);
});

describe('OnboardingGate', () => {
  it('welcomes an account that has not been set up', async () => {
    mockStatus(status());
    render(<OnboardingGate />);

    expect(await screen.findByText('Welcome to mailviz')).toBeInTheDocument();
  });

  it('renders nothing for an account that already completed setup', async () => {
    mockStatus(status({ needsOnboarding: false, completedAt: '2026-01-01T00:00:00.000Z' }));
    const { container } = render(<OnboardingGate />);

    await waitFor(() => expect(onboardingApi.getStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Welcome to mailviz')).not.toBeInTheDocument();
  });

  it('stays silent when the status call fails', async () => {
    vi.mocked(onboardingApi.getStatus).mockRejectedValue(new Error('offline'));
    const { container } = render(<OnboardingGate />);

    await waitFor(() => expect(onboardingApi.getStatus).toHaveBeenCalled());
    // An unasked-for tour must not turn a network blip into an error screen.
    expect(container).toBeEmptyDOMElement();
  });

  it('records a dismissal as skipped so it does not reappear every login', async () => {
    mockStatus(status());
    render(<OnboardingGate />);
    await screen.findByText('Welcome to mailviz');

    await userEvent.click(await screen.findByRole('button', { name: /explore on my own/i }));

    await waitFor(() => expect(onboardingApi.complete).toHaveBeenCalledWith(true));
    expect(screen.queryByText('Welcome to mailviz')).not.toBeInTheDocument();
  });

  it('moves from the tour into the wizard', async () => {
    mockStatus(status());
    render(<OnboardingGate />);
    await screen.findByText('Welcome to mailviz');

    // Walk to the last view, where the setup call to action lives. Awaited
    // rather than queried synchronously: the header renders before the body
    // finishes building its steps, so the footer buttons appear a tick later.
    await userEvent.click(await screen.findByRole('button', { name: /^next$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^next$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /set up mailviz/i }));

    // Matched by role — the step title also appears as a label in the progress
    // rail, so a bare text query is ambiguous.
    expect(await screen.findByRole('heading', { name: 'Your task board' })).toBeInTheDocument();
    // Entering the wizard must not yet mark setup complete.
    expect(onboardingApi.complete).not.toHaveBeenCalled();
  });

  it('tells a user with existing columns that nothing will change', async () => {
    mockStatus(
      status({
        steps: { ...status().steps, taskStatusCount: 4 },
        blocking: ['dealPartners'],
      })
    );
    render(<OnboardingGate />);
    await screen.findByText('Welcome to mailviz');
    await userEvent.click(await screen.findByRole('button', { name: /^next$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^next$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /set up mailviz/i }));

    expect(await screen.findByText(/already have 4 columns/i)).toBeInTheDocument();
  });
});
