import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThreadDetail, threadRows, recipientsLine } from './ThreadDetail';
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
    archive: vi.fn(), unarchive: vi.fn().mockResolvedValue({}), trash: vi.fn(), untrash: vi.fn().mockResolvedValue({}),
    batchArchive: vi.fn().mockResolvedValue({}),
    batchTrash: vi.fn().mockResolvedValue({}),
    batchMarkAsUnread: vi.fn().mockResolvedValue({}),
    createReminder: vi.fn().mockResolvedValue({}),
    getThreadShares: vi.fn().mockResolvedValue({ data: { data: [] } }),
    getAttachmentUrl: (emailId: string, attachmentId: string) => `/api/v1/emails/${emailId}/attachments/${attachmentId}`,
    getAttachmentInlineUrl: (emailId: string, attachmentId: string) => `/api/v1/emails/${emailId}/attachments/${attachmentId}?inline=true`,
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
vi.mock('./ThreadTenders', () => ({ ThreadTenders: () => null }));
vi.mock('../shared/AttachmentPreviewModal', () => ({
  AttachmentPreviewModal: ({ open, items, index }: { open: boolean; items: Array<{ file: { filename: string } }>; index: number }) =>
    open && items[index] ? <div data-testid="attachment-preview">{items[index].file.filename}</div> : null,
}));
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

/**
 * Buttons named by their tooltip. Carbon's IconButton is named through
 * aria-labelledby to its tooltip; with autoAlign, floating-ui keeps that
 * tooltip `visibility: hidden` in jsdom (it cannot measure anything), and
 * jsdom's name computation then skips it — a browser does not. So read the
 * label the way the browser does.
 */
function labelled(name: string, root: HTMLElement = document.body): HTMLElement[] {
  return within(root).queryAllByRole('button').filter((b) => {
    const id = b.getAttribute('aria-labelledby');
    return (id ? document.getElementById(id)?.textContent : b.getAttribute('aria-label') ?? b.textContent)?.trim() === name;
  });
}

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

  it('offers Reply at the foot of the thread as a real button', async () => {
    const { container } = renderThread();

    // A div with an onClick satisfies a click test and fails this one.
    await screen.findAllByRole('button', { name: /message from Sender/i });
    const bar = container.querySelector('.thread-reply-bar')!;
    expect(within(bar as HTMLElement).getByRole('button', { name: 'Reply' })).toBeInTheDocument();
    expect(within(bar as HTMLElement).getByRole('button', { name: 'Forward' })).toBeInTheDocument();
  });
});

describe('ThreadDetail — attachments', () => {
  it('opens the preview for a file that cannot be rendered, instead of downloading it', async () => {
    // Word, Excel and the rest used to be bare download links here while the
    // company and contact tables opened the preview (with its download
    // prompt) for every file. Same click, same result, on every page.
    const user = userEvent.setup();
    const withDocx = message('a', { attachments: [{ id: 'att-1', emailId: 'a', gmailAttachmentId: 'g1', filename: 'Proposal.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 2048 }] });
    vi.mocked(emailsApi.getThread).mockResolvedValue({ data: { data: [withDocx] } } as never);
    // The expanded message is re-fetched in full; that copy is what renders.
    vi.mocked(emailsApi.getMessage).mockResolvedValue({ data: { data: withDocx } } as never);
    renderThread();

    const chip = await screen.findByRole('button', { name: /Proposal\.docx/ });
    expect(chip).not.toHaveAttribute('href');
    expect(screen.queryByTestId('attachment-preview')).toBeNull();

    await user.click(chip);

    expect(screen.getByTestId('attachment-preview')).toHaveTextContent('Proposal.docx');
    // The explicit download stays on the icon beside the name.
    expect(screen.getByTitle('Download')).toHaveAttribute('href', '/api/v1/emails/a/attachments/att-1');
  });
});

describe('ThreadDetail — one toolbar for the conversation', () => {
  it('offers each conversation action once, not once per message', async () => {
    vi.mocked(emailsApi.getThread).mockResolvedValue({
      data: { data: [message('a', { labelIds: ['INBOX'] }), message('b', { labelIds: ['INBOX'] }), message('c', { labelIds: ['INBOX'] })] },
    } as never);
    renderThread();

    const toolbar = await screen.findByRole('toolbar', { name: 'Conversation actions' });
    for (const name of ['Archive', 'Move to trash', 'Mark as unread', 'Snooze or follow up', 'Create a task', 'Share conversation']) {
      expect(labelled(name, toolbar)).toHaveLength(1);
      expect(labelled(name)).toHaveLength(1);
    }
  });

  it('archives the whole thread and closes the reader', async () => {
    const user = userEvent.setup();
    const onThreadGone = vi.fn();
    vi.mocked(emailsApi.getThread).mockResolvedValue({ data: { data: [message('a', { labelIds: ['INBOX'] }), message('b', { labelIds: ['INBOX'] })] } } as never);
    render(<MemoryRouter><ThreadDetail threadId="thread-1" onThreadGone={onThreadGone} /></MemoryRouter>);

    await screen.findByRole('toolbar');
    await user.click(labelled('Archive')[0]);

    expect(emailsApi.batchArchive).toHaveBeenCalledWith(['b']);
    expect(onThreadGone).toHaveBeenCalled();
  });

  it('offers Move to Inbox once the thread is archived, and moves every archived message', async () => {
    const user = userEvent.setup();
    vi.mocked(emailsApi.getThread).mockResolvedValue({
      data: { data: [message('a', { isArchived: true }), message('b', { isArchived: true })] },
    } as never);
    renderThread();

    await screen.findByRole('toolbar');
    await user.click(labelled('Move to Inbox')[0]);

    expect(emailsApi.unarchive).toHaveBeenCalledTimes(2);
    expect(emailsApi.batchArchive).not.toHaveBeenCalled();
  });
});

describe('ThreadDetail — reading', () => {
  it('folds the quoted history under a reply until asked', async () => {
    const user = userEvent.setup();
    const reply = message('a', { body: '<p>My answer</p><div class="gmail_quote">On Mon, Omar wrote: the old question</div>' });
    vi.mocked(emailsApi.getThread).mockResolvedValue({ data: { data: [reply] } } as never);
    vi.mocked(emailsApi.getMessage).mockResolvedValue({ data: { data: reply } } as never);
    const { container } = renderThread();

    const toggle = await screen.findByRole('button', { name: 'Show quoted history' });
    const body = container.querySelector('.message-card__html')!;
    expect(body.getAttribute('data-quotes')).toBe('hidden');
    expect(body.querySelector('[data-mv-quoted]')?.textContent).toContain('the old question');

    await user.click(toggle);
    expect(body.getAttribute('data-quotes')).toBe('shown');
    expect(screen.getByRole('button', { name: 'Hide quoted history' })).toBeInTheDocument();
  });

  it('hides the middle of a long thread behind one line', async () => {
    const user = userEvent.setup();
    const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => message(id));
    vi.mocked(emailsApi.getThread).mockResolvedValue({ data: { data: eight } } as never);
    renderThread();

    const gap = await screen.findByRole('button', { name: '5 earlier messages' });
    expect(screen.getAllByRole('button', { name: /message from Sender/i })).toHaveLength(3);

    await user.click(gap);
    expect(screen.getAllByRole('button', { name: /message from Sender/i })).toHaveLength(8);
  });
});

describe('threadRows', () => {
  const m = (id: string, isRead = true) => message(id, { isRead }) as never;
  it('keeps the first, the last two, and anything open or unread', () => {
    const rows = threadRows([m('1'), m('2'), m('3', false), m('4'), m('5'), m('6'), m('7')], new Set(['5']), false);
    expect(rows.map((r) => (r.kind === 'gap' ? `gap${r.count}` : (r.msg as { id: string }).id))).toEqual(['1', 'gap1', '3', 'gap1', '5', '6', '7']);
  });

  it('shows everything for five messages or fewer, or when asked', () => {
    const five = ['1', '2', '3', '4', '5'].map((id) => m(id));
    expect(threadRows(five, new Set(), false)).toHaveLength(5);
    expect(threadRows([...five, m('6')], new Set(), true)).toHaveLength(6);
  });
});

describe('recipientsLine', () => {
  const own = new Set(['me@powerm.ma']);
  it('names you as "me", people by name, and counts the rest', () => {
    expect(recipientsLine({ to: ['me@powerm.ma', 'Sara Alami <sara@awb.ma>'], cc: ['a@x.ma', 'b@x.ma'] }, own)).toBe('to me, Sara Alami and 2 others');
    expect(recipientsLine({ to: ['omar@bkam.ma'], cc: [] }, own)).toBe('to omar@bkam.ma');
    expect(recipientsLine({ to: [], cc: [] }, own)).toBe('');
  });
});
