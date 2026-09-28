import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThreadDetail, threadRows, recipientsLine } from './ThreadDetail';
import { emailsApi } from '../../api/emails';
import { contactsApi } from '../../api/contacts';
import DOMPurify from 'dompurify';
import { QUOTED_ATTR } from '../../utils/mailQuotes';

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

  it('sanitises the folded body, so nothing re-parses its output', async () => {
    const sanitize = vi.spyOn(DOMPurify, 'sanitize');
    const reply = message('a', {
      body: '<p>My answer</p><div class="gmail_quote">On Mon: <img src="x" onerror="alert(1)"></div>',
    });
    vi.mocked(emailsApi.getThread).mockResolvedValue({ data: { data: [reply] } } as never);
    vi.mocked(emailsApi.getMessage).mockResolvedValue({ data: { data: reply } } as never);
    const { container } = renderThread();

    await screen.findByRole('button', { name: 'Show quoted history' });
    const call = sanitize.mock.calls.findIndex(([html]) => String(html).includes('My answer'));
    expect(call).toBeGreaterThanOrEqual(0);
    // It is handed the folded markup — folding came first…
    expect(String(sanitize.mock.calls[call][0])).toContain(QUOTED_ATTR);
    // …and what it returns is what the page renders.
    expect(container.querySelector('.message-card__html')!.innerHTML).toBe(String(sanitize.mock.results[call].value));
    expect(container.querySelector('[onerror]')).toBeNull();
    sanitize.mockRestore();
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

describe('ThreadDetail — opening a message takes one click', () => {
  /** Resolves when told to: a body arriving late. */
  function deferred() {
    let resolve: (v: unknown) => void = () => {};
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
  }
  const bodyOf = (id: string) => ({ data: { data: message(id, { body: `<p>Full text of ${id}</p>` }) } });
  const header = (id: string) => screen.getByRole('button', { name: new RegExp(`message from Sender ${id}$`) });

  it('opens every unread message with its whole text — REGRESSION', async () => {
    // Only the first unread message's body was fetched; the others opened on
    // their snippet, so a click collapsed them and a second click loaded them.
    vi.mocked(emailsApi.getThread).mockResolvedValue({
      data: { data: [message('a'), message('b', { isRead: false, body: null }), message('c', { isRead: false, body: null })] },
    } as never);
    vi.mocked(emailsApi.getMessage).mockImplementation(async (id: string) => bodyOf(id) as never);
    renderThread();

    expect(await screen.findByText('Full text of b')).toBeInTheDocument();
    expect(await screen.findByText('Full text of c')).toBeInTheDocument();
    expect(header('b')).toHaveAttribute('aria-expanded', 'true');
    expect(header('c')).toHaveAttribute('aria-expanded', 'true');
    // Shown open is read, as Gmail has it — both of them, not the first alone.
    await waitFor(() => expect(emailsApi.markAsRead).toHaveBeenCalledTimes(2));
    expect(vi.mocked(emailsApi.markAsRead).mock.calls.map(([id]) => id).sort()).toEqual(['b', 'c']);
  });

  it('opens a message on the first click, and says it is loading', async () => {
    const user = userEvent.setup();
    vi.mocked(emailsApi.getThread).mockResolvedValue({
      data: { data: [message('a', { body: null }), message('b')] },
    } as never);
    const late = deferred();
    vi.mocked(emailsApi.getMessage).mockImplementation(() => late.promise as never);
    renderThread();

    await user.click(await screen.findByRole('button', { name: /Expand message from Sender a$/ }));
    expect(header('a')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Loading message...')).toBeInTheDocument();

    late.resolve(bodyOf('a'));
    expect(await screen.findByText('Full text of a')).toBeInTheDocument();
  });

  it('keeps both open when two messages are clicked before either arrives', async () => {
    const user = userEvent.setup();
    vi.mocked(emailsApi.getThread).mockResolvedValue({
      data: { data: [message('a', { body: null }), message('b', { body: null }), message('c')] },
    } as never);
    const bodies = { a: deferred(), b: deferred() };
    vi.mocked(emailsApi.getMessage).mockImplementation((id: string) => bodies[id as 'a' | 'b'].promise as never);
    renderThread();

    await user.click(await screen.findByRole('button', { name: /Expand message from Sender a$/ }));
    await user.click(screen.getByRole('button', { name: /Expand message from Sender b$/ }));
    bodies.a.resolve(bodyOf('a'));
    bodies.b.resolve(bodyOf('b'));

    expect(await screen.findByText('Full text of a')).toBeInTheDocument();
    expect(await screen.findByText('Full text of b')).toBeInTheDocument();
    expect(header('a')).toHaveAttribute('aria-expanded', 'true');
    expect(header('b')).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not fetch a message it is closing', async () => {
    // Its text failed to load: closing it is not a reason to try again.
    const user = userEvent.setup();
    vi.mocked(emailsApi.getThread).mockResolvedValue({
      data: { data: [message('a', { body: null }), message('b')] },
    } as never);
    vi.mocked(emailsApi.getMessage).mockRejectedValue(new Error('offline'));
    renderThread();

    await user.click(await screen.findByRole('button', { name: /Expand message from Sender a$/ }));
    await waitFor(() => expect(screen.queryByText('Loading message...')).toBeNull());
    await user.click(header('a'));
    expect(header('a')).toHaveAttribute('aria-expanded', 'false');
    expect(emailsApi.getMessage).toHaveBeenCalledTimes(1);
  });

  it('fetches a body once, however many times its message is opened', async () => {
    const user = userEvent.setup();
    vi.mocked(emailsApi.getThread).mockResolvedValue({
      data: { data: [message('a', { body: null }), message('b')] },
    } as never);
    const late = deferred();
    vi.mocked(emailsApi.getMessage).mockImplementation(() => late.promise as never);
    renderThread();

    // Open, close, open again while the first request is still out.
    await user.click(await screen.findByRole('button', { name: /Expand message from Sender a$/ }));
    await user.click(header('a'));
    await user.click(header('a'));
    late.resolve(bodyOf('a'));

    expect(await screen.findByText('Full text of a')).toBeInTheDocument();
    expect(emailsApi.getMessage).toHaveBeenCalledTimes(1);
  });
});

/**
 * jsdom has no IntersectionObserver. This one reports what a test says is on
 * screen: `show('b', 0.6)` puts 60% of message b's 400px card in view of an
 * 800px reader.
 */
class FakeIntersectionObserver {
  static latest: FakeIntersectionObserver | null = null;
  elements: Element[] = [];
  constructor(public callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.latest = this;
  }
  observe(el: Element) { this.elements.push(el); }
  unobserve() {}
  disconnect() { this.elements = []; }
  takeRecords() { return []; }
}
function show(id: string, fraction: number) {
  const io = FakeIntersectionObserver.latest!;
  const target = io.elements.find((el) => (el as HTMLElement).dataset.messageId === id)!;
  act(() => {
    io.callback([{
      target,
      isIntersecting: fraction > 0,
      intersectionRatio: fraction,
      intersectionRect: { height: 400 * fraction },
      boundingClientRect: { height: 400 },
      rootBounds: { height: 800 },
    } as unknown as IntersectionObserverEntry], io as unknown as IntersectionObserver);
  });
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ThreadDetail — the timeline rail', () => {
  const rail = () => screen.queryByRole('navigation', { name: 'Thread timeline' });

  it('stands beside a conversation, not beside a message and its answer', async () => {
    renderThread();
    await screen.findByRole('button', { name: /message from Sender b$/ });
    expect(rail()).toBeNull();
  });

  it('opens a message folded into "earlier messages" from its marker, and only that one', async () => {
    const user = userEvent.setup();
    const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) =>
      message(id, { body: id === 'h' ? '<p>body h</p>' : null, receivedAt: `2026-08-1${i}T09:00:00.000Z` }));
    vi.mocked(emailsApi.getThread).mockResolvedValue({ data: { data: eight } } as never);
    vi.mocked(emailsApi.getMessage).mockImplementation(async (id: string) =>
      ({ data: { data: message(id, { body: `<p>Full text of ${id}</p>` }) } }) as never);
    renderThread();

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await screen.findByRole('button', { name: '5 earlier messages' });
    await user.click(within(rail()!).getByRole('button', { name: /^Sender d,/ }));

    expect(await screen.findByText('Full text of d')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /message from Sender d$/ })).toHaveAttribute('aria-expanded', 'true');
    // d came out of the gap, splitting it in two; b, c, e and f stay folded.
    expect(screen.getAllByRole('button', { name: '2 earlier messages' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /message from Sender c$/ })).toBeNull();
    // Two gaps are two rows to React, not one key twice.
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    errors.mockRestore();
  });

  describe('reading what is on screen', () => {
    beforeEach(() => {
      vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
      vi.mocked(emailsApi.getThread).mockResolvedValue({
        data: { data: [message('a'), message('b', { isRead: false }), message('c', { isRead: false })] },
      } as never);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      FakeIntersectionObserver.latest = null;
    });

    it('reads an unread message once it has been on screen, not on a glimpse, and outlines it on the rail', async () => {
      renderThread();
      await screen.findByText('body c');

      show('b', 0.2);
      await pause(700);
      expect(emailsApi.markAsRead).not.toHaveBeenCalled();
      expect(screen.getByTestId('timeline-band')).toBeInTheDocument();

      show('b', 0.6);
      await waitFor(() => expect(emailsApi.markAsRead).toHaveBeenCalledWith('b'), { timeout: 2000 });
      // c never came into view: still unread, on the server and on the rail.
      expect(emailsApi.markAsRead).not.toHaveBeenCalledWith('c');
      await waitFor(() => expect(within(rail()!).getByRole('button', { name: '1 new' })).toBeInTheDocument());
    });

    it('reads a message opened from the rail at once, seen or not', async () => {
      const user = userEvent.setup();
      renderThread();
      await screen.findByText('body c');

      await user.click(within(rail()!).getByRole('button', { name: /^Sender c,/ }));
      expect(emailsApi.markAsRead).toHaveBeenCalledWith('c');
      expect(emailsApi.markAsRead).not.toHaveBeenCalledWith('b');
    });

    it('asks once, however often a message is seen before the answer comes', async () => {
      let answer: (v: unknown) => void = () => {};
      vi.mocked(emailsApi.markAsRead).mockImplementation(() => new Promise((r) => { answer = r; }) as never);
      renderThread();
      await screen.findByText('body b');

      show('b', 1);
      await waitFor(() => expect(emailsApi.markAsRead).toHaveBeenCalledTimes(1), { timeout: 2000 });
      show('b', 0.9);
      await pause(700);
      expect(emailsApi.markAsRead).toHaveBeenCalledTimes(1);
      answer({});
    });
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
