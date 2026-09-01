import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThreadDetail } from './ThreadDetail';
import { emailsApi } from '../../api/emails';
import { contactsApi } from '../../api/contacts';

/**
 * The thread reader, from a keyboard.
 *
 * Every control that mattered here was a bare `<div onClick>`: expanding a
 * message, the collapsed snippet, and "Click to reply...". So a keyboard user
 * could read the one message that happened to be open and do nothing else —
 * not read the rest of the thread, not reply. The sender avatar was the worst
 * of them, carrying `role="button"` and `tabIndex={0}` with no key handler at
 * all: a focus stop that swallowed Enter silently, which is worse than not
 * being focusable, because it looks operable.
 *
 * Asserted through roles and real key presses rather than by checking for
 * tabIndex attributes — an element can carry every ARIA attribute and still do
 * nothing when activated, which is precisely the state the avatar was in.
 */

vi.mock('../../api/emails', () => ({
  emailsApi: {
    getThread: vi.fn(),
    getMessage: vi.fn(),
    markAsRead: vi.fn().mockResolvedValue({}),
    markAsUnread: vi.fn().mockResolvedValue({}),
    toggleStar: vi.fn().mockResolvedValue({}),
    archive: vi.fn(), unarchive: vi.fn(), trash: vi.fn(), untrash: vi.fn(),
  },
}));

vi.mock('../../api/contacts', () => ({
  contactsApi: { lookupByEmail: vi.fn() },
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

// Hoisted and stable. Returning a fresh `vi.fn()` from the selector gives
// `addNotification` a new identity on every render, which invalidates the
// component's `useCallback` and refires its fetch effect — an infinite refetch
// loop that looks exactly like a component stuck on its loading skeleton.
const addNotification = vi.fn();
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: (s: { addNotification: typeof addNotification }) => unknown) =>
    selector({ addNotification }),
}));

vi.mock('./ConvertToTaskModal', () => ({ ConvertToTaskModal: () => null }));
vi.mock('./AttachmentPreviewModal', () => ({ AttachmentPreviewModal: () => null }));
vi.mock('./MailComposeModal', () => ({ MailComposeModal: () => null }));
vi.mock('../shared/ShareDialog', () => ({ ShareDialog: () => null }));

function message(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    threadId: 'thread-1',
    subject: 'Quote request',
    from: `sender-${id}@acme.test`,
    fromName: `Sender ${id}`,
    to: ['me@mailviz.test'],
    cc: [],
    snippet: `snippet ${id}`,
    body: `<p>body ${id}</p>`,
    isRead: true,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    receivedAt: '2026-08-10T09:00:00.000Z',
    attachments: [],
    labelIds: [],
    customerId: 'customer-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(emailsApi.getThread).mockResolvedValue({
    data: { data: [message('a'), message('b')] },
  } as never);
  vi.mocked(emailsApi.getMessage).mockResolvedValue({
    data: { data: message('a') },
  } as never);
});

function renderThread() {
  return render(
    <MemoryRouter>
      <ThreadDetail threadId="thread-1" />
    </MemoryRouter>
  );
}

describe('ThreadDetail — keyboard operability', () => {
  it('exposes each message header as a control with a name', async () => {
    renderThread();

    const headers = await screen.findAllByRole('button', { name: /message from Sender/i });
    expect(headers.length).toBeGreaterThanOrEqual(2);
  });

  it('expands a message with the keyboard', async () => {
    const user = userEvent.setup();
    renderThread();

    // The collapsed one — the thread auto-expands the newest, so target the
    // header that still reports itself closed.
    const headers = await screen.findAllByRole('button', { name: /message from Sender/i });
    const collapsed = headers.find((h) => h.getAttribute('aria-expanded') === 'false');
    expect(collapsed).toBeTruthy();

    collapsed!.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(collapsed!.getAttribute('aria-expanded')).toBe('true'));
  });

  it('reports expansion state, so a screen reader can tell open from closed', async () => {
    renderThread();

    const headers = await screen.findAllByRole('button', { name: /message from Sender/i });
    // Both states must actually occur — if everything reported the same value
    // the attribute would be decoration rather than information.
    const states = headers.map((h) => h.getAttribute('aria-expanded'));
    expect(states).toContain('true');
    expect(states).toContain('false');
  });

  it('opens the sender on Enter rather than only on click', async () => {
    const user = userEvent.setup();
    vi.mocked(contactsApi.lookupByEmail).mockResolvedValue({
      data: { data: { id: 'contact-9' } },
    } as never);
    renderThread();

    const avatar = (await screen.findAllByRole('button', { name: /view contact/i }))[0];
    avatar.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/contacts/contact-9'));
  });

  it('offers the reply trigger as a real button', async () => {
    renderThread();

    // A div with an onClick satisfies a click test and fails this one.
    expect(await screen.findByRole('button', { name: /click to reply/i })).toBeInTheDocument();
  });
});
