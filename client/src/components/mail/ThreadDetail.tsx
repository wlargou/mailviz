import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Tag,
  Button,
  IconButton,
  InlineLoading,
  SkeletonText,
  OverflowMenu,
  MenuItem,
  MenuItemDivider,
  FeatureFlags,
} from '@carbon/react';
import {
  StarFilled,
  Download,
  Archive,
  TrashCan,
  Undo,
  EmailNew,
  TaskAdd,
  Reply,
  ReplyAll,
  Share,
  Snooze,
  ChevronDown,
  ChevronUp,
  OverflowMenuHorizontal,
} from '@carbon/icons-react';
import { contactsApi } from '../../api/contacts';
import { UserAvatar } from '@carbon/ibm-products';
import { format } from 'date-fns';
import DOMPurify from 'dompurify';
import { useNavigate } from 'react-router-dom';
import { emailsApi } from '../../api/emails';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { EmptyState } from '../shared/EmptyState';
import { ConvertToTaskModal } from './ConvertToTaskModal';
import { AttachmentPreviewModal } from '../shared/AttachmentPreviewModal';
import { MailComposeModal } from './MailComposeModal';
import { SnoozeModal } from './SnoozeModal';
import { ShareDialog } from '../shared/ShareDialog';
import { ThreadTenders } from './ThreadTenders';
import { ThreadTimeline } from './ThreadTimeline';
import { getFileTypeInfo, formatFileSize as formatSize } from '../../utils/fileTypes';
import { foldQuotedHistory } from '../../utils/mailQuotes';
import { bareAddress, ownAddressesIn, replyRecipients } from '../../utils/replyRecipients';
import { mailListDate } from '../../utils/dates';
import type { EmailMessage, EmailAttachment, ComposeMode, ReminderKind } from '../../types/email';
import { decodeEntities } from '../../utils/text';

/**
 * A conversation, read beside the list.
 *
 * What it used to be: every message a tall card carrying nine icon buttons —
 * three of them thread-level actions repeated per message, Forward drawn as
 * a "send" arrow, Unarchive as Undo — with tooltips landing a hundred pixels
 * from their buttons, and every reply re-rendering the whole quoted history
 * (7,000px for a five-message thread). Now:
 *
 *  - one toolbar for the conversation (archive, trash, unread, snooze, task,
 *    share), at the top, labelled;
 *  - per message only Reply and a menu for the rest;
 *  - collapsed messages are single lines, and a long thread hides its middle
 *    behind "N earlier messages";
 *  - quoted history is folded behind "•••" (see utils/mailQuotes);
 *  - Reply / Reply all / Forward at the foot, addressed correctly even when
 *    the last message is your own.
 */

interface ThreadDetailProps {
  threadId: string;
  onEmailAction?: () => void;
  /** The conversation left this view — archived, trashed, snoozed, marked unread. */
  onThreadGone?: () => void;
  /** The subject, once known: the host panel's title. */
  onLoaded?: (subject: string) => void;
}

/**
 * Carbon's OverflowMenu is typed as the classic one; behind the
 * `enable-v12-overflowmenu` flag it is the Menu-based one, whose props
 * (`label`, `menuAlignment`, MenuItem children) these are.
 */
const MessageMenu = OverflowMenu as unknown as React.ComponentType<{
  label: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  autoAlign?: boolean;
  menuAlignment?: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
  children: React.ReactNode;
}>;

/** Threads longer than this hide their middle messages. */
const SHOW_ALL_UP_TO = 5;

/** The timeline rail is for a conversation, not a message and its answer. */
const RAIL_MIN_MESSAGES = 3;
/** Below this width the rail would squeeze the messages; it steps aside. */
const RAIL_MIN_WIDTH = 560;
/**
 * An unread message counts as seen once half of it — or half the reader — has
 * been on screen and the scrolling has paused this long. Opening one, from its
 * card or the rail, reads it at once.
 */
const SEEN_AFTER_MS = 500;

/** The element that scrolls `el` — the host panel's body, not the page. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
  return node;
}

type Row = { kind: 'message'; msg: EmailMessage } | { kind: 'gap'; count: number };

/** Hide the middle of a long thread: keep the first, the last two, and anything open or unread. */
export function threadRows(messages: EmailMessage[], expanded: Set<string>, showAll: boolean): Row[] {
  if (showAll || messages.length <= SHOW_ALL_UP_TO) return messages.map((msg) => ({ kind: 'message', msg }));
  const rows: Row[] = [];
  let hidden = 0;
  messages.forEach((msg, i) => {
    const keep = i === 0 || i >= messages.length - 2 || expanded.has(msg.id) || !msg.isRead;
    if (keep) {
      if (hidden > 0) rows.push({ kind: 'gap', count: hidden });
      hidden = 0;
      rows.push({ kind: 'message', msg });
    } else {
      hidden += 1;
    }
  });
  return rows;
}

/** "to me, Sara and 3 others" — who a message went to, in a line. */
export function recipientsLine(msg: Pick<EmailMessage, 'to' | 'cc'>, own: Set<string>): string {
  const all = [...msg.to, ...msg.cc];
  if (all.length === 0) return '';
  const label = (value: string) => {
    if (own.has(bareAddress(value))) return 'me';
    const name = /^\s*"?([^"<]+?)"?\s*</.exec(value)?.[1]?.trim();
    return name || bareAddress(value);
  };
  const names = [...new Set(all.map(label))];
  const shown = names.slice(0, 2).join(', ');
  const rest = names.length - 2;
  return rest > 0 ? `to ${shown} and ${rest} other${rest === 1 ? '' : 's'}` : `to ${shown}`;
}

function MessageBody({ msg, showQuotes, onToggleQuotes }: { msg: EmailMessage; showQuotes: boolean; onToggleQuotes: () => void }) {
  // Fold, then sanitise. The sanitiser's output is safe to parse once, and
  // folding parses and re-serialises it — done after, it would hand the page
  // markup the sanitiser never saw. DOMParser's document is inert, so folding
  // the raw body runs nothing.
  const folded = useMemo(() => {
    const { html, folded } = foldQuotedHistory(msg.body ?? '', decodeEntities(msg.subject));
    return { html: DOMPurify.sanitize(html), folded };
  }, [msg.body, msg.subject]);
  return (
    <>
      <div
        className="message-card__html"
        data-quotes={folded.folded && !showQuotes ? 'hidden' : 'shown'}
        dangerouslySetInnerHTML={{ __html: folded.html }}
      />
      {folded.folded && (
        <Button
          kind="ghost"
          size="sm"
          className="message-card__quotes"
          renderIcon={OverflowMenuHorizontal}
          onClick={onToggleQuotes}
          aria-expanded={showQuotes}
        >
          {showQuotes ? 'Hide quoted history' : 'Show quoted history'}
        </Button>
      )}
    </>
  );
}

export function ThreadDetail({ threadId, onEmailAction, onThreadGone, onLoaded }: ThreadDetailProps) {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [detailsOpen, setDetailsOpen] = useState<Set<string>>(new Set());
  const [quotesShown, setQuotesShown] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [loadingBodies, setLoadingBodies] = useState<Set<string>>(new Set());
  const [convertEmail, setConvertEmail] = useState<EmailMessage | null>(null);
  /**
   * The preview opens on one attachment but steps through the message's
   * whole set — a tender arrives as an RC, a CPS and three annexes on one
   * mail, and reading them meant closing and reopening between each.
   */
  const [preview, setPreview] = useState<{ emailId: string; attachments: EmailAttachment[]; index: number } | null>(null);
  const [composeState, setComposeState] = useState<{ mode: ComposeMode; email: EmailMessage } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozeSaving, setSnoozeSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [threadShares, setThreadShares] = useState<Array<{ id: string; createdAt: string; sharedWith: { id: string; name: string | null; email: string; avatarUrl: string | null } }>>([]);
  const scrollTargetRef = useRef<string | null>(null);
  const [scrollTick, setScrollTick] = useState(0);
  const messageRefs = useRef<Map<string, HTMLElement>>(new Map());
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** Messages on screen, for the rail's outline. */
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  /** …and those shown enough to count as seen. */
  const shownRef = useRef<Set<string>>(new Set());
  const seenTimer = useRef<number | undefined>(undefined);
  const [wide, setWide] = useState(true);
  /** Requests in flight, so a body or a read is never asked for twice. */
  const bodyRequests = useRef<Set<string>>(new Set());
  const readRequests = useRef<Set<string>>(new Set());
  // Read from callbacks that outlive a render (observers, timers).
  const messagesRef = useRef<EmailMessage[]>([]);
  const onEmailActionRef = useRef(onEmailAction);
  messagesRef.current = messages;
  onEmailActionRef.current = onEmailAction;
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);
  const userEmail = useAuthStore((s) => s.user?.email);

  /** Fetches a message's whole text, once; its card says "Loading" meanwhile. */
  const loadBody = useCallback(async (id: string) => {
    if (bodyRequests.current.has(id)) return;
    bodyRequests.current.add(id);
    setLoadingBodies((prev) => new Set(prev).add(id));
    try {
      const { data: res } = await emailsApi.getMessage(id);
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, body: res.data.body } : m)));
    } catch {
      // The snippet stands in.
    } finally {
      bodyRequests.current.delete(id);
      setLoadingBodies((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const markRead = useCallback((msg: EmailMessage) => {
    if (msg.isRead || readRequests.current.has(msg.id)) return;
    readRequests.current.add(msg.id);
    emailsApi.markAsRead(msg.id).then(() => {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, isRead: true } : m)));
      onEmailActionRef.current?.();
    }).catch(() => {
      readRequests.current.delete(msg.id);
    });
  }, []);

  const fetchThread = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await emailsApi.getThread(threadId);
      setMessages(res.data);
      if (res.data.length > 0) {
        onLoaded?.(decodeEntities(res.data[0].subject));
        // Open the first unread message, or the latest.
        const firstUnread = res.data.find((m) => !m.isRead);
        const targetMsg = firstUnread || res.data[res.data.length - 1];
        const toExpand = new Set<string>([targetMsg.id]);
        res.data.forEach((m) => { if (!m.isRead) toExpand.add(m.id); });
        setExpandedMessages(toExpand);
        scrollTargetRef.current = targetMsg.id;

        // Every message shown open gets its whole text. Only the first unread
        // one used to: the others opened on their snippet, so a click folded
        // them and a second click finally loaded them.
        await Promise.all(res.data.filter((m) => toExpand.has(m.id) && !m.body).map((m) => loadBody(m.id)));
        // What is on screen is read once seen (see SEEN_AFTER_MS). Without an
        // observer there is no telling, so what is shown open counts as read.
        if (typeof IntersectionObserver === 'undefined') {
          res.data.filter((m) => toExpand.has(m.id)).forEach(markRead);
        }
      }
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load thread' });
    } finally {
      setLoading(false);
    }
    // onLoaded is a notification, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, addNotification, loadBody, markRead]);

  useEffect(() => {
    setShowAll(false);
    setDetailsOpen(new Set());
    setQuotesShown(new Set());
    fetchThread();
  }, [fetchThread]);

  /**
   * Bring the opened message to the top of the reader. Scrolls the reader's
   * own scroll container — `scrollIntoView` also scrolled the page behind the
   * panel — and clears the sticky toolbar.
   */
  useEffect(() => {
    if (loading || !scrollTargetRef.current || messages.length < 2) return;
    const el = messageRefs.current.get(scrollTargetRef.current);
    scrollTargetRef.current = null;
    if (!el) return;
    const scroller = scrollParent(el);
    if (!scroller) return;
    const toolbar = rootRef.current?.querySelector('.thread-toolbar')?.getBoundingClientRect().height ?? 0;
    const target = scroller;
    requestAnimationFrame(() => {
      const delta = el.getBoundingClientRect().top - target.getBoundingClientRect().top - toolbar - 8;
      target.scrollTo?.({ top: target.scrollTop + delta, behavior: 'smooth' });
    });
  }, [loading, messages, scrollTick]);

  // The messages rendered, in order — what the observer below watches.
  const renderedKey = useMemo(
    () => threadRows(messages, expandedMessages, showAll).map((r) => (r.kind === 'message' ? r.msg.id : 'gap')).join(','),
    [messages, expandedMessages, showAll],
  );

  /**
   * What is on screen: the rail outlines it, and an unread message shown
   * enough, once the scrolling pauses, is marked read — so the rail's blue
   * dots are the messages not seen yet, not the ones never clicked.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (loading || !root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      setVisibleIds((prev) => {
        const next = new Set(prev);
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.messageId;
          if (!id) continue;
          if (e.isIntersecting) next.add(id);
          else next.delete(id);
        }
        return next;
      });
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.messageId;
        if (!id) continue;
        // Half the message, or half the reader for one taller than it.
        const needed = Math.min(e.boundingClientRect.height, e.rootBounds?.height ?? Infinity) / 2;
        if (e.isIntersecting && e.intersectionRect.height >= needed) shownRef.current.add(id);
        else shownRef.current.delete(id);
      }
      window.clearTimeout(seenTimer.current);
      seenTimer.current = window.setTimeout(() => {
        for (const id of shownRef.current) {
          const msg = messagesRef.current.find((m) => m.id === id);
          if (msg) markRead(msg);
        }
      }, SEEN_AFTER_MS);
    }, { root: scrollParent(root), threshold: [0, 0.25, 0.5, 0.75, 1] });
    root.querySelectorAll('[data-message-id]').forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      window.clearTimeout(seenTimer.current);
    };
  }, [loading, renderedKey, markRead]);

  // The rail only where there is room for it beside the messages.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= RAIL_MIN_WIDTH));
    observer.observe(root);
    return () => observer.disconnect();
  }, [loading]);

  const own = useMemo(() => ownAddressesIn(userEmail, messages), [userEmail, messages]);
  const latest = messages[messages.length - 1];
  const inInbox = messages.some((m) => m.labelIds?.includes('INBOX') && !m.isTrashed);
  const inTrash = messages.length > 0 && messages.every((m) => m.isTrashed);

  /** Open the sender's contact page, falling back to their company. */
  const openSender = (msg: EmailMessage) => async () => {
    try {
      const res = await contactsApi.lookupByEmail(msg.from);
      if (res.data.data) navigate(`/contacts/${res.data.data.id}`);
      else if (msg.customerId) navigate(`/customers/${msg.customerId}`);
    } catch {
      if (msg.customerId) navigate(`/customers/${msg.customerId}`);
    }
  };

  /**
   * Open or close a message — at once, from the latest state. It used to wait
   * for the body before opening, so a first click looked dead; and it wrote a
   * snapshot back, so a second message clicked meanwhile closed the first.
   */
  const toggleExpand = (msg: EmailMessage) => {
    const opening = !expandedMessages.has(msg.id);
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(msg.id)) next.delete(msg.id);
      else next.add(msg.id);
      return next;
    });
    if (opening && !msg.body) void loadBody(msg.id);
    markRead(msg);
  };

  /** From the rail: open the message — even one folded into the gap — and bring it up. */
  const openMessage = (id: string) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg) return;
    setExpandedMessages((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    if (!msg.body) void loadBody(id);
    markRead(msg);
    scrollTargetRef.current = id;
    setScrollTick((t) => t + 1);
  };

  const toggleIn = (setter: typeof setDetailsOpen, id: string) =>
    setter((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const handleToggleStar = async (msg: EmailMessage) => {
    try {
      await emailsApi.toggleStar(msg.id);
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, isStarred: !m.isStarred } : m)));
      onEmailAction?.();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to update star' });
    }
  };

  /** Run a conversation-level action; `gone` when the thread leaves this view. */
  const threadAction = async (run: () => Promise<unknown>, done: string, failed: string, gone: boolean) => {
    setBusy(true);
    try {
      await run();
      addNotification({ kind: 'success', title: done });
      onEmailAction?.();
      if (gone && onThreadGone) onThreadGone();
      else await fetchThread();
    } catch {
      addNotification({ kind: 'error', title: failed });
    } finally {
      setBusy(false);
    }
  };

  const archiveOrRestore = () =>
    inInbox
      ? threadAction(() => emailsApi.batchArchive([latest.id]), 'Archived', 'Could not archive', true)
      : threadAction(
          () => Promise.all(messages.filter((m) => m.isArchived && !m.isTrashed).map((m) => emailsApi.unarchive(m.id))),
          'Moved to Inbox',
          'Could not move to Inbox',
          false,
        );

  const trashOrRestore = () =>
    inTrash
      ? threadAction(() => Promise.all(messages.map((m) => emailsApi.untrash(m.id))), 'Restored', 'Could not restore', false)
      : threadAction(() => emailsApi.batchTrash([latest.id]), 'Moved to trash', 'Could not move to trash', true);

  const markUnread = () =>
    threadAction(() => emailsApi.batchMarkAsUnread([latest.id]), 'Marked as unread', 'Could not mark as unread', true);

  const submitSnooze = async (kind: ReminderKind, remindAt: Date) => {
    setSnoozeSaving(true);
    try {
      await emailsApi.createReminder({ threadId, kind, remindAt: remindAt.toISOString() });
      addNotification({
        kind: 'success',
        title: kind === 'snooze' ? 'Snoozed' : 'Follow-up set',
        subtitle: `${kind === 'snooze' ? 'Back' : 'Reminder'} ${format(remindAt, 'EEE d MMM, HH:mm')}`,
      });
      setSnoozeOpen(false);
      onEmailAction?.();
      if (kind === 'snooze') onThreadGone?.();
    } catch {
      addNotification({ kind: 'error', title: 'Could not set the reminder' });
    } finally {
      setSnoozeSaving(false);
    }
  };

  const fetchShares = useCallback(async () => {
    try {
      const { data: res } = await emailsApi.getThreadShares(threadId);
      setThreadShares(res.data);
    } catch {
      // A missing list is not worth a toast.
    }
  }, [threadId]);

  const handleOpenShare = async () => {
    await fetchShares();
    setShareOpen(true);
  };

  if (loading && messages.length === 0) {
    return (
      <div className="thread-detail" tabIndex={-1} style={{ padding: '1rem' }}>
        <SkeletonText heading width="60%" />
        <SkeletonText paragraph lineCount={4} />
      </div>
    );
  }

  if (messages.length === 0) {
    return <EmptyState title="No messages" />;
  }

  const customer = messages.find((m) => m.customer)?.customer;
  const rows = threadRows(messages, expandedMessages, showAll);
  const showRail = wide && messages.length >= RAIL_MIN_MESSAGES;
  const latestReplyAll = replyRecipients(latest, true, own);
  const canReplyAll = latestReplyAll.to.length + latestReplyAll.cc.length > 1;

  return (
    // Focusable, so a host SidePanel can land focus here
    // (selectorPrimaryFocus=".thread-detail") instead of on its close
    // button — whose tooltip then sat open over the header.
    <div className="thread-detail" ref={rootRef} tabIndex={-1}>
      <div className="thread-toolbar" role="toolbar" aria-label="Conversation actions">
        <IconButton kind="ghost" size="sm" autoAlign align="bottom" label={inInbox ? 'Archive' : 'Move to Inbox'} disabled={busy} onClick={archiveOrRestore}>
          {inInbox ? <Archive /> : <Undo />}
        </IconButton>
        <IconButton kind="ghost" size="sm" autoAlign align="bottom" label={inTrash ? 'Restore from trash' : 'Move to trash'} disabled={busy} onClick={trashOrRestore}>
          {inTrash ? <Undo /> : <TrashCan />}
        </IconButton>
        <IconButton kind="ghost" size="sm" autoAlign align="bottom" label="Mark as unread" disabled={busy} onClick={markUnread}>
          <EmailNew />
        </IconButton>
        <IconButton kind="ghost" size="sm" autoAlign align="bottom" label="Snooze or follow up" disabled={busy} onClick={() => setSnoozeOpen(true)}>
          <Snooze />
        </IconButton>
        <span className="thread-toolbar__divider" aria-hidden="true" />
        <IconButton kind="ghost" size="sm" autoAlign align="bottom" label="Create a task" onClick={() => setConvertEmail(latest)}>
          <TaskAdd />
        </IconButton>
        <IconButton kind="ghost" size="sm" autoAlign align="bottom" label="Share conversation" onClick={handleOpenShare}>
          <Share />
        </IconButton>
        {customer && (
          <Tag
            type="cool-gray"
            size="sm"
            className="clickable-tag thread-toolbar__company"
            onClick={() => navigate(`/customers/${customer.id}`)}
          >
            {customer.name}
          </Tag>
        )}
      </div>

      <ThreadTenders threadId={threadId} />

      <div className={`thread-body${showRail ? ' thread-body--rail' : ''}`}>
        {showRail && (
          <div className="thread-body__rail">
            <ThreadTimeline messages={messages} own={own} visibleIds={visibleIds} onOpen={openMessage} />
          </div>
        )}
        <ol className="thread-messages">
          {rows.map((row, i) => {
            if (row.kind === 'gap') {
              return (
                // By position: a message opened from the rail can split the gap in two.
                <li key={`gap-${i}`} className="thread-gap">
                  <button type="button" className="thread-gap__button" onClick={() => setShowAll(true)}>
                    {row.count} earlier {row.count === 1 ? 'message' : 'messages'}
                  </button>
                </li>
              );
            }
            const msg = row.msg;
            const isExpanded = expandedMessages.has(msg.id);
            const sender = decodeEntities(msg.fromName || msg.from);

            return (
              <li
                key={msg.id}
                data-message-id={msg.id}
                ref={(el) => { if (el) messageRefs.current.set(msg.id, el); }}
                className={`message-card${isExpanded ? ' message-card--open' : ''}${!msg.isRead ? ' message-card--unread' : ''}`}
              >
                <div
                  className="message-card__header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} message from ${sender}`}
                  onClick={(e) => {
                    // The controls inside the header are their own.
                    if ((e.target as HTMLElement).closest('button, a, .message-card__avatar, .cds--overflow-menu, .cds--menu')) return;
                    toggleExpand(msg);
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpand(msg);
                    }
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    className="message-card__avatar"
                    title="View contact"
                    aria-label={`View contact ${sender}`}
                    onClick={openSender(msg)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void openSender(msg)();
                      }
                    }}
                  >
                    <UserAvatar name={sender} size="sm" />
                  </div>
                  <div className="message-card__who">
                    <span className={`message-card__sender${!msg.isRead ? ' message-card__sender--unread' : ''}`}>
                      {sender}
                      {isExpanded && msg.fromName && <span className="message-card__address">{msg.from}</span>}
                    </span>
                    {isExpanded ? (
                      <button
                        type="button"
                        className="message-card__recipients"
                        aria-expanded={detailsOpen.has(msg.id)}
                        onClick={() => toggleIn(setDetailsOpen, msg.id)}
                      >
                        {recipientsLine(msg, own) || 'Details'}
                        {detailsOpen.has(msg.id) ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    ) : (
                      <span className="message-card__snippet">{decodeEntities(msg.snippet)}</span>
                    )}
                  </div>
                  <div className="message-card__side">
                    {msg.isStarred && <StarFilled size={14} className="message-card__star" aria-label="Starred" />}
                    <span className="message-card__date" title={format(new Date(msg.receivedAt), 'EEEE d MMMM yyyy, HH:mm')}>
                      {mailListDate(msg.receivedAt)}
                    </span>
                    {isExpanded && (
                      <>
                        <IconButton kind="ghost" size="sm" autoAlign label="Reply" onClick={() => setComposeState({ mode: 'reply', email: msg })}>
                          <Reply />
                        </IconButton>
                        {/* The v12 menu: Carbon's Menu floats above the SidePanel, the classic one does not. */}
                        <FeatureFlags enableV12Overflowmenu>
                          <MessageMenu label="More actions for this message" size="sm" autoAlign menuAlignment="bottom-end">
                            <MenuItem label="Reply all" onClick={() => setComposeState({ mode: 'replyAll', email: msg })} />
                            <MenuItem label="Forward" onClick={() => setComposeState({ mode: 'forward', email: msg })} />
                            <MenuItemDivider />
                            <MenuItem label={msg.isStarred ? 'Remove star' : 'Star'} onClick={() => handleToggleStar(msg)} />
                            <MenuItem label="Create a task from this message" onClick={() => setConvertEmail(msg)} />
                          </MessageMenu>
                        </FeatureFlags>
                      </>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="message-card__body">
                    {detailsOpen.has(msg.id) && (
                      <dl className="message-card__meta">
                        <dt>From</dt>
                        <dd>{msg.fromName ? `${decodeEntities(msg.fromName)} <${msg.from}>` : msg.from}</dd>
                        {msg.to.length > 0 && (<><dt>To</dt><dd>{msg.to.join(', ')}</dd></>)}
                        {msg.cc.length > 0 && (<><dt>Cc</dt><dd>{msg.cc.join(', ')}</dd></>)}
                        <dt>Date</dt>
                        <dd>{format(new Date(msg.receivedAt), 'EEEE d MMMM yyyy, HH:mm')}</dd>
                      </dl>
                    )}

                    {loadingBodies.has(msg.id) ? (
                      <InlineLoading description="Loading message..." />
                    ) : msg.body ? (
                      <MessageBody msg={msg} showQuotes={quotesShown.has(msg.id)} onToggleQuotes={() => toggleIn(setQuotesShown, msg.id)} />
                    ) : (
                      <p className="message-card__plain">{decodeEntities(msg.snippet) || '(No content)'}</p>
                    )}

                    {msg.attachments.length > 0 && (
                      <div className="message-bubble__attachments">
                        {msg.attachments.map((att) => {
                          const FileIcon = getFileTypeInfo(att.mimeType, att.filename).icon;
                          return (
                            <div key={att.id} className="attachment-chip">
                              {/* Every file opens the preview; the explicit
                                  download stays on the icon beside it. */}
                              <button
                                type="button"
                                className="attachment-chip__clickable"
                                onClick={() => setPreview({ emailId: msg.id, attachments: msg.attachments, index: msg.attachments.findIndex((a) => a.id === att.id) })}
                              >
                                <FileIcon size={16} />
                                <span className="attachment-chip__name">{decodeEntities(att.filename)}</span>
                                <span className="attachment-chip__size">{formatSize(att.size)}</span>
                              </button>
                              <a
                                className="attachment-chip__download"
                                href={emailsApi.getAttachmentUrl(msg.id, att.id)}
                                download={decodeEntities(att.filename)}
                                onClick={(e) => e.stopPropagation()}
                                title="Download"
                              >
                                <Download size={14} />
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="thread-reply-bar">
        <Button kind="tertiary" size="sm" renderIcon={Reply} onClick={() => setComposeState({ mode: 'reply', email: latest })}>
          Reply
        </Button>
        {canReplyAll && (
          <Button kind="ghost" size="sm" renderIcon={ReplyAll} onClick={() => setComposeState({ mode: 'replyAll', email: latest })}>
            Reply all
          </Button>
        )}
        <Button kind="ghost" size="sm" onClick={() => setComposeState({ mode: 'forward', email: latest })}>
          Forward
        </Button>
      </div>

      {convertEmail && (
        <ConvertToTaskModal
          email={convertEmail}
          open={!!convertEmail}
          onClose={() => setConvertEmail(null)}
          onConverted={() => {
            setConvertEmail(null);
            fetchThread();
            onEmailAction?.();
          }}
        />
      )}

      <AttachmentPreviewModal
        open={!!preview}
        items={(preview?.attachments ?? []).map((att) => ({
          file: att,
          inlineUrl: emailsApi.getAttachmentInlineUrl(preview!.emailId, att.id),
          downloadUrl: emailsApi.getAttachmentUrl(preview!.emailId, att.id),
        }))}
        index={preview?.index ?? 0}
        onIndexChange={(index) => setPreview((p) => (p ? { ...p, index } : p))}
        onClose={() => setPreview(null)}
      />

      <MailComposeModal
        open={!!composeState}
        onClose={() => setComposeState(null)}
        onSent={() => {
          setComposeState(null);
          fetchThread();
          onEmailAction?.();
        }}
        mode={composeState?.mode || 'reply'}
        replyToEmail={composeState?.email}
        ownAddresses={own}
      />

      {/* On <body>: a Modal inside the SidePanel resolves `fixed` against the
          panel (see CLAUDE.md, Modals inside SidePanel). */}
      {snoozeOpen && createPortal(
        <SnoozeModal
          open
          subject={decodeEntities(latest.subject)}
          saving={snoozeSaving}
          onClose={() => setSnoozeOpen(false)}
          onSubmit={submitSnooze}
        />,
        document.body,
      )}

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={decodeEntities(messages[0]?.subject) || 'Thread'}
        currentShares={threadShares}
        onShare={async (userIds) => {
          await emailsApi.shareThread(threadId, userIds);
        }}
        onUnshare={async (userId) => {
          await emailsApi.unshareThread(threadId, userId);
        }}
        onRefresh={fetchShares}
      />
    </div>
  );
}
