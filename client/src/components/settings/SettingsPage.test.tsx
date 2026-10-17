import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { GoogleStatus } from '../../types/calendar';

/**
 * The Google connection on the Account tab.
 *
 * A grant Google refused used to read exactly like a healthy one here: a green
 * Connected tag and nothing else, while the server skipped the account every
 * minute. Two things are pinned: the refusal is said, in words, the moment the
 * server learns it — without a reload — and Reconnect Google is on offer
 * whatever the state, because it is the recovery that keeps the synced data
 * and the only other button deletes it.
 */

const ws = vi.hoisted(() => ({
  handlers: {} as Record<string, (data: unknown) => void>,
  options: {} as { onReconnect?: () => void },
}));

vi.mock('../../hooks/useEmailWebSocket', () => ({
  useEmailWebSocket: (handlers: Record<string, (data: unknown) => void>, options = {}) => {
    ws.handlers = handlers;
    ws.options = options;
  },
}));
vi.mock('../../api/auth', () => ({
  authApi: {
    getGoogleStatus: vi.fn(),
    getGoogleUrl: vi.fn(),
    getSignature: vi.fn(),
    disconnectGoogle: vi.fn(),
  },
}));
const emptyList = () => ({ getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) });
vi.mock('../../api/taskStatuses', () => ({ taskStatusesApi: emptyList() }));
vi.mock('../../api/companyCategories', () => ({ companyCategoriesApi: emptyList() }));
vi.mock('../../api/dealPartners', () => ({ dealPartnersApi: emptyList() }));
vi.mock('../../api/labels', () => ({ labelsApi: emptyList() }));
// The other tabs' editors fetch their own data and are not what this is about.
vi.mock('../mail/TiptapEditor', () => ({ TiptapEditor: () => null }));
vi.mock('./TemplateSettings', () => ({ TemplateSettings: () => null }));
vi.mock('./TaskTemplateSettings', () => ({ TaskTemplateSettings: () => null }));
vi.mock('./OnboardingSettings', () => ({ OnboardingSettings: () => null }));
vi.mock('./TimezoneSetting', () => ({ TimezoneSetting: () => null }));
vi.mock('./DeleteAccountModal', () => ({ DeleteAccountModal: () => null }));

const { authApi } = await import('../../api/auth');
const { SettingsPage } = await import('./SettingsPage');

const healthy: GoogleStatus = {
  connected: true,
  email: 'me@example.test',
  needsReauth: false,
  authError: null,
};

const refused: GoogleStatus = {
  ...healthy,
  needsReauth: true,
  authError: { code: 'invalid_grant', at: '2026-10-17T08:00:00.000Z' },
};

function statusIs(...answers: GoogleStatus[]) {
  const mock = vi.mocked(authApi.getGoogleStatus);
  mock.mockReset();
  for (const answer of answers) mock.mockResolvedValueOnce({ data: { data: answer } } as never);
  mock.mockResolvedValue({ data: { data: answers.at(-1) } } as never);
}

function renderSettings() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ws.handlers = {};
  vi.mocked(authApi.getSignature).mockResolvedValue({ data: { signature: null } } as never);
  vi.mocked(authApi.getGoogleUrl).mockResolvedValue({ data: { data: { url: '#google-consent' } } } as never);
});

describe('SettingsPage — Google connection', () => {
  it('says sync has stopped, and why, when Google refused the grant', async () => {
    statusIs(refused);
    renderSettings();

    expect(await screen.findByText('Sync has stopped')).toBeInTheDocument();
    // In words, not the code: the user has to know what happened and what
    // to do about it.
    expect(screen.getByText(/no longer accepts this app’s access/)).toBeInTheDocument();
    expect(screen.queryByText('invalid_grant')).not.toBeInTheDocument();
    // And no green "Connected" beside it — that tag was the lie.
    expect(screen.getByText('Sync stopped')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reconnect google/i })).toBeInTheDocument();
  });

  it('offers Reconnect Google on a healthy connection too', async () => {
    statusIs(healthy);
    renderSettings();

    // Before, it appeared only when the stored scopes fell short, so a grant
    // the server could not tell was broken offered nothing but Disconnect —
    // which deletes the synced mail.
    expect(await screen.findByRole('button', { name: /reconnect google/i })).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByText('Sync has stopped')).not.toBeInTheDocument();
  });

  it('reconnects through the consent URL', async () => {
    const user = userEvent.setup();
    statusIs(refused);
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /reconnect google/i }));

    // GET /auth/google/url is the connect flow, which forces consent and so
    // always brings a new refresh token — the login URL would not.
    expect(authApi.getGoogleUrl).toHaveBeenCalledTimes(1);
  });

  it('shows the refusal without a reload when the server announces it', async () => {
    statusIs(healthy, refused);
    renderSettings();
    expect(await screen.findByText('Connected')).toBeInTheDocument();

    await act(async () => {
      ws.handlers['google:auth']?.({ authError: refused.authError });
    });

    expect(await screen.findByText('Sync has stopped')).toBeInTheDocument();
  });

  it('takes the warning down when the grant works again', async () => {
    statusIs(refused, healthy);
    renderSettings();
    expect(await screen.findByText('Sync has stopped')).toBeInTheDocument();

    await act(async () => {
      ws.handlers['google:auth']?.({ authError: null });
    });

    await waitFor(() => expect(screen.queryByText('Sync has stopped')).not.toBeInTheDocument());
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('catches up after the socket was down, when the event may have been missed', async () => {
    statusIs(healthy, refused);
    renderSettings();
    expect(await screen.findByText('Connected')).toBeInTheDocument();

    await act(async () => {
      ws.options.onReconnect?.();
    });

    expect(await screen.findByText('Sync has stopped')).toBeInTheDocument();
  });
});
