import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MailPage } from './MailPage';
import { emailsApi } from '../../api/emails';
import { useUIStore } from '../../store/uiStore';

/**
 * The Scheduled folder, once the scheduler can take an email out from under it.
 *
 * The server claims a due email (`pending` → `sending`) before sending it, and
 * refuses a cancel or reschedule of a claimed one with 409. The list on screen
 * was loaded before the claim, so it still shows a pending row with working
 * buttons: the refusal has to say what happened and reread the list. And the
 * server announces every send, failure and retry (`email:scheduled:sent`),
 * which the page did not listen to.
 */

const ws = vi.hoisted(() => ({
  handlers: {} as Record<string, (data?: unknown) => void>,
  options: {} as { onReconnect?: () => void },
}));

vi.mock('../../hooks/useEmailWebSocket', () => ({
  useEmailWebSocket: (handlers: Record<string, (data?: unknown) => void>, options: { onReconnect?: () => void } = {}) => {
    ws.handlers = handlers;
    ws.options = options;
  },
}));

vi.mock('../../api/emails', () => ({
  emailsApi: {
    getScheduledEmails: vi.fn(),
    cancelScheduledEmail: vi.fn(),
    updateScheduledEmail: vi.fn(),
    getReminders: vi.fn(),
    getRepliesOwed: vi.fn(),
    getThreads: vi.fn(),
    getCategoryCounts: vi.fn(),
  },
}));
vi.mock('../../api/drafts', () => ({ draftsApi: { sync: vi.fn(), list: vi.fn(), open: vi.fn(), remove: vi.fn() } }));

// Everything else on the page is beside the point here, and some of it fetches.
vi.mock('./ThreadDetail', () => ({ ThreadDetail: () => null }));
vi.mock('./MailComposeModal', () => ({ MailComposeModal: () => null }));
vi.mock('./ConvertToTaskModal', () => ({ ConvertToTaskModal: () => null }));
vi.mock('./SnoozeModal', () => ({ SnoozeModal: () => null }));
vi.mock('./MailCategoriesModal', () => ({ MailCategoriesModal: () => null }));
vi.mock('./MailCategoryTabs', () => ({ MailCategoryTabs: () => null }));
vi.mock('./MailFolderBar', () => ({ MailFolderBar: () => null }));
vi.mock('./ToReplyList', () => ({ ToReplyList: () => null }));
vi.mock('./MailSearchBar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./MailSearchBar')>()),
  MailSearchBar: () => null,
}));

const INTERRUPTED = 'Sending was interrupted, and it may have gone out. Check Sent before sending it again.';

type Row = {
  id: string;
  subject: string;
  to: string[];
  sendAt: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';
  errorMessage: string | null;
};

function scheduled(overrides: Partial<Row> = {}): Row {
  return {
    id: 's1',
    subject: 'Proposal',
    to: ['client@customer.test'],
    // Tomorrow: the reschedule dialog opens on this time, and refuses a past one.
    sendAt: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'pending',
    errorMessage: null,
    ...overrides,
  };
}

const listed = (rows: Row[]) => ({ data: { data: rows } }) as never;

/** What axios rejects with for an HTTP error — `isAxiosError` reads the flag. */
function httpError(status: number, message: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: { error: { message } } },
  });
}

const titles = () => useUIStore.getState().notifications.map((n) => n.title);

function renderScheduled() {
  return render(
    <MemoryRouter initialEntries={['/mail?folder=scheduled']}>
      <MailPage />
    </MemoryRouter>,
  );
}

/** The row for a subject — the buttons are looked up inside it. */
async function rowFor(subject: string) {
  const title = await screen.findByText(subject);
  return title.closest('.scheduled-email-item') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  ws.handlers = {};
  ws.options = {};
  useUIStore.setState({ notifications: [] });
  vi.mocked(emailsApi.getReminders).mockResolvedValue({ data: { data: [] } } as never);
  vi.mocked(emailsApi.getRepliesOwed).mockResolvedValue({ data: { data: [] } } as never);
  vi.mocked(emailsApi.getThreads).mockResolvedValue({ data: { data: [], meta: null } } as never);
  vi.mocked(emailsApi.getCategoryCounts).mockResolvedValue({ data: { data: {} } } as never);
});

describe('Scheduled — a change refused because the email is being sent', () => {
  it('a cancel says it is being sent, and shows the row as it now is — REGRESSION', async () => {
    vi.mocked(emailsApi.getScheduledEmails)
      .mockResolvedValueOnce(listed([scheduled()]))
      .mockResolvedValue(listed([scheduled({ status: 'sending' })]));
    vi.mocked(emailsApi.cancelScheduledEmail).mockRejectedValue(
      httpError(409, 'This email is being sent and can no longer be changed'),
    );
    renderScheduled();

    await userEvent.click(within(await rowFor('Proposal')).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(titles()).toContain('This email is being sent right now'));
    expect(titles()).not.toContain('Failed to cancel');
    // Reread: the row is `sending` now, with nothing left to press.
    await waitFor(() => expect(within(screen.getByText('Proposal').closest('.scheduled-email-item') as HTMLElement).getByText('sending')).toBeInTheDocument());
    expect(emailsApi.getScheduledEmails).toHaveBeenCalledTimes(2);
    const row = screen.getByText('Proposal').closest('.scheduled-email-item') as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument();
  });

  it('a reschedule says it is being sent, closes the dialog and shows the row as it now is — REGRESSION', async () => {
    vi.mocked(emailsApi.getScheduledEmails)
      .mockResolvedValueOnce(listed([scheduled()]))
      .mockResolvedValue(listed([scheduled({ status: 'sending' })]));
    vi.mocked(emailsApi.updateScheduledEmail).mockRejectedValue(
      httpError(409, 'This email is being sent and can no longer be changed'),
    );
    renderScheduled();

    await userEvent.click(within(await rowFor('Proposal')).getByRole('button', { name: 'Reschedule' }));
    await userEvent.click(screen.getByRole('button', { name: 'Update send time' }));

    await waitFor(() => expect(titles()).toContain('This email is being sent right now'));
    expect(emailsApi.updateScheduledEmail).toHaveBeenCalledTimes(1);
    expect(titles()).not.toContain('Failed to reschedule');
    await waitFor(() => expect(emailsApi.getScheduledEmails).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('sending')).toBeInTheDocument();
    // Nothing left to reschedule, so the dialog does not stay open over it.
    expect(document.querySelector('.cds--modal.is-visible')).toBeNull();
  });

  it('any other failure keeps the plain message, and does not reread', async () => {
    vi.mocked(emailsApi.getScheduledEmails).mockResolvedValue(listed([scheduled()]));
    vi.mocked(emailsApi.cancelScheduledEmail).mockRejectedValue(httpError(500, 'Internal server error'));
    renderScheduled();

    await userEvent.click(within(await rowFor('Proposal')).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(titles()).toContain('Failed to cancel'));
    expect(titles()).not.toContain('This email is being sent right now');
    expect(emailsApi.getScheduledEmails).toHaveBeenCalledTimes(1);
  });
});

describe('Scheduled — kept current', () => {
  it('rereads the list when the server says a scheduled email was sent', async () => {
    vi.mocked(emailsApi.getScheduledEmails)
      .mockResolvedValueOnce(listed([scheduled()]))
      // Sent rows are not listed: it leaves the folder.
      .mockResolvedValue(listed([]));
    renderScheduled();
    await rowFor('Proposal');

    act(() => ws.handlers['email:scheduled:sent']?.({ id: 's1' }));

    expect(await screen.findByText('No scheduled emails')).toBeInTheDocument();
    expect(emailsApi.getScheduledEmails).toHaveBeenCalledTimes(2);
  });

  it('rereads the list after the socket reconnects, since events sent meanwhile are lost', async () => {
    vi.mocked(emailsApi.getScheduledEmails)
      .mockResolvedValueOnce(listed([scheduled()]))
      .mockResolvedValue(listed([scheduled({ status: 'failed', errorMessage: INTERRUPTED })]));
    renderScheduled();
    await rowFor('Proposal');

    act(() => ws.options.onReconnect?.());

    expect(await screen.findByText('failed')).toBeInTheDocument();
    expect(emailsApi.getScheduledEmails).toHaveBeenCalledTimes(2);
  });
});

describe('Scheduled — a failed send', () => {
  it('gives its reason a line of its own, not the truncating one under the recipients', async () => {
    // The meta line ends in an ellipsis; this message ends with what to do.
    vi.mocked(emailsApi.getScheduledEmails).mockResolvedValue(
      listed([scheduled({ status: 'failed', errorMessage: INTERRUPTED })]),
    );
    renderScheduled();

    const reason = await screen.findByText(INTERRUPTED);
    expect(reason).toHaveClass('scheduled-email-item__error');
    expect(reason).not.toHaveClass('scheduled-email-item__meta');
  });
});
