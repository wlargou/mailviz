import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Tag, InlineLoading, SkeletonText } from '@carbon/react';
import {
  StarFilled,
  Star,
  Attachment,
  Email as EmailIcon,
  EmailNew,
  ReplyAll,
  TrashCan,
  Undo,
  ChevronDown,
  ChevronUp,
} from '@carbon/icons-react';
import { formatDistanceToNow } from 'date-fns';
import { emailsApi } from '../../../api/emails';
import { useUIStore } from '../../../store/uiStore';
import { UNCATEGORIZED_CUSTOMER_ID } from '../../../types/email';
import type { EmailThread } from '../../../types/email';
import type { PaginationMeta } from '../../../types/api';
import type { ReviewPeriod } from './ReviewPage';
import { decodeEntities } from '../../../utils/text';

/**
 * One company's slice of the review, fetched and paged on its own.
 *
 * The review used to pull `limit=500` once and group in the browser. That
 * silently truncated (worse than it looked — the server caps `limit` at 100),
 * and the unread toggle filtered *after* the fetch, so it could never recover a
 * thread the cap had already dropped. Each group now asks the server for its
 * own customer, its own date window and — when the unread toggle is on — its
 * own `isRead=false`, and pulls further batches on demand.
 */

/** Batch size for each request. The server caps `limit` at 100. */
const PAGE_SIZE = 25;

interface Props {
  /** Customer id, or null for the Uncategorized bucket. */
  customerId: string | null;
  customerName: string;
  customerLogoUrl: string | null;
  isVip: boolean;
  /** Authoritative counts from `getReviewSummary` — never a partial page count. */
  totalThreads: number;
  unreadThreads: number;
  period: ReviewPeriod;
  unreadOnly: boolean;
  defaultExpanded: boolean;
  selectedThreadId: string | null;
  onSelectThread: (thread: EmailThread) => void;
  /** Fired after a thread action so the parent can refresh the summary counts. */
  onThreadsChanged: () => void;
}

export function ReviewCustomerGroup({
  customerId,
  customerName,
  customerLogoUrl,
  isVip,
  totalThreads,
  unreadThreads,
  period,
  unreadOnly,
  defaultExpanded,
  selectedThreadId,
  onSelectThread,
  onThreadsChanged,
}: Props) {
  const addNotification = useUIStore((s) => s.addNotification);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  // Identity of the query this group represents. Anything that changes it
  // invalidates whatever is already loaded.
  const queryKey = `${customerId ?? UNCATEGORIZED_CUSTOMER_ID}|${period.dateAfter}|${period.dateBefore}|${unreadOnly}`;
  const loadedKeyRef = useRef<string | null>(null);
  // Guards against a stale response landing after the toggle moved on.
  const requestRef = useRef(0);

  const headerCount = unreadOnly ? unreadThreads : totalThreads;

  const buildParams = useCallback(
    (page: number): Record<string, string> => {
      const params: Record<string, string> = {
        dateAfter: period.dateAfter,
        dateBefore: period.dateBefore,
        customerId: customerId ?? UNCATEGORIZED_CUSTOMER_ID,
        page: String(page),
        limit: String(PAGE_SIZE),
      };
      // Server-side, so the unread view is a different query rather than a
      // filter over an already-truncated result set.
      if (unreadOnly) params.isRead = 'false';
      return params;
    },
    [period.dateAfter, period.dateBefore, customerId, unreadOnly]
  );

  const loadFirstPage = useCallback(async () => {
    const token = ++requestRef.current;
    setLoading(true);
    setFailed(false);
    try {
      const { data: res } = await emailsApi.getThreads(buildParams(1));
      if (token !== requestRef.current) return;
      setThreads(res.data);
      setMeta(res.meta ?? null);
    } catch {
      if (token !== requestRef.current) return;
      setFailed(true);
    } finally {
      if (token === requestRef.current) setLoading(false);
    }
  }, [buildParams]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    // No meta means the first page never landed — this is a retry of it.
    if (!meta) {
      void loadFirstPage();
      return;
    }
    const token = ++requestRef.current;
    setLoadingMore(true);
    setFailed(false);
    try {
      const { data: res } = await emailsApi.getThreads(buildParams(meta.page + 1));
      if (token !== requestRef.current) return;
      setThreads((prev) => {
        // Rows shift when a thread is read or trashed mid-review, so a later
        // page can repeat one already on screen. Append only what is new.
        const seen = new Set(prev.map((t) => t.threadId));
        return [...prev, ...res.data.filter((t) => !seen.has(t.threadId))];
      });
      setMeta(res.meta ?? null);
    } catch {
      if (token !== requestRef.current) return;
      setFailed(true);
    } finally {
      if (token === requestRef.current) setLoadingMore(false);
    }
  }, [meta, loadingMore, buildParams, loadFirstPage]);

  // Drop anything loaded for a query that no longer applies.
  useEffect(() => {
    if (loadedKeyRef.current !== null && loadedKeyRef.current !== queryKey) {
      loadedKeyRef.current = null;
      setThreads([]);
      setMeta(null);
    }
  }, [queryKey]);

  // Fetch lazily: a group that is never opened never costs a request.
  useEffect(() => {
    if (!expanded || headerCount === 0) return;
    if (loadedKeyRef.current === queryKey) return;
    loadedKeyRef.current = queryKey;
    void loadFirstPage();
  }, [expanded, queryKey, headerCount, loadFirstPage]);

  const patchThread = (threadId: string | null, patch: (t: EmailThread) => EmailThread) => {
    setThreads((prev) => prev.map((t) => (t.threadId === threadId ? patch(t) : t)));
  };

  /** Optimistic: apply locally, call the API, put it back on failure. */
  const handleThreadAction = async (
    action: 'star' | 'trash' | 'readToggle',
    thread: EmailThread,
    ev: React.MouseEvent
  ) => {
    ev.stopPropagation();
    const e = thread.latestEmail;
    const before = thread;

    if (action === 'star') {
      patchThread(thread.threadId, (t) => ({
        ...t,
        latestEmail: { ...t.latestEmail, isStarred: !t.latestEmail.isStarred },
      }));
    } else if (action === 'trash') {
      patchThread(thread.threadId, (t) => ({
        ...t,
        latestEmail: { ...t.latestEmail, isTrashed: !t.latestEmail.isTrashed },
      }));
    } else {
      const nowRead = thread.unreadCount > 0;
      patchThread(thread.threadId, (t) => ({
        ...t,
        unreadCount: nowRead ? 0 : Math.max(1, t.unreadCount),
        latestEmail: { ...t.latestEmail, isRead: nowRead },
      }));
    }

    try {
      if (action === 'star') await emailsApi.toggleStar(e.id);
      else if (action === 'trash') {
        if (e.isTrashed) await emailsApi.untrash(e.id);
        else await emailsApi.trash(e.id);
      } else if (thread.unreadCount > 0) await emailsApi.markAsRead(e.id);
      else await emailsApi.markAsUnread(e.id);
      onThreadsChanged();
    } catch {
      patchThread(before.threadId, () => before);
      addNotification({ kind: 'error', title: 'Action failed' });
    }
  };

  const showing = threads.length;
  const total = meta?.total ?? headerCount;
  const noun = unreadOnly ? 'unread threads' : 'threads';

  return (
    <div className="review-group">
      <div
        className="review-group__header"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        <div className="review-group__title">
          {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          {customerLogoUrl && <img src={customerLogoUrl} alt="" className="review-group__logo" />}
          <span className="review-group__name">{customerName}</span>
          {isVip && <StarFilled size={14} className="vip-star" />}
          {/* Always the summary's count for the whole period, never the number
              of rows that happen to be loaded. */}
          <Tag size="sm" type="cool-gray">
            {headerCount} {noun}
          </Tag>
          {!unreadOnly && unreadThreads > 0 && (
            <Tag size="sm" type="blue">
              {unreadThreads} unread
            </Tag>
          )}
        </div>
      </div>

      {expanded && (
        <>
          {headerCount === 0 ? (
            <p className="review-group__empty">
              {unreadOnly ? 'Nothing unread in this period' : 'No emails in this period'}
            </p>
          ) : loading ? (
            <div className="review-group__skeleton">
              <SkeletonText paragraph lineCount={3} />
            </div>
          ) : (
            <>
              <div className="thread-list">
                {threads.map((thread) => {
                  const e = thread.latestEmail;
                  const isUnread = thread.unreadCount > 0;
                  const isSelected = thread.threadId === selectedThreadId;

                  return (
                    <div
                      key={thread.threadId}
                      role="button"
                      tabIndex={0}
                      className={`thread-item${isUnread ? ' thread-item--unread' : ' thread-item--read'}${e.customer?.isVip ? ' thread-item--vip' : e.customer?.isInternal ? ' thread-item--internal' : ''}${isSelected ? ' thread-item--selected' : ''}`}
                      onClick={() => onSelectThread(thread)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          onSelectThread(thread);
                        }
                      }}
                    >
                      <div className="thread-item__top">
                        <span className="thread-item__sender">
                          {decodeEntities(e.contactName || e.fromName || e.from)}
                        </span>
                        <span className="thread-item__subject-inline">{decodeEntities(e.subject)}</span>
                        <div className="thread-item__right">
                          <span className="thread-item__meta">
                            {e.isStarred && <StarFilled size={14} className="thread-item__star" />}
                            {e.hasAttachment && <Attachment size={14} className="thread-item__attachment" />}
                            {thread.messageCount > 1 && (
                              <Tag size="sm" type="cool-gray">{thread.messageCount}</Tag>
                            )}
                            <span>{formatDistanceToNow(new Date(e.receivedAt), { addSuffix: true })}</span>
                          </span>
                        </div>
                        <div className="thread-item__actions">
                          <Button
                            kind="ghost"
                            size="sm"
                            hasIconOnly
                            iconDescription={e.isStarred ? 'Unstar' : 'Star'}
                            renderIcon={e.isStarred ? StarFilled : Star}
                            className={e.isStarred ? 'thread-action--starred' : ''}
                            onClick={(ev: React.MouseEvent) => handleThreadAction('star', thread, ev)}
                          />
                          <Button
                            kind="ghost"
                            size="sm"
                            hasIconOnly
                            iconDescription="Reply All"
                            renderIcon={ReplyAll}
                            onClick={(ev: React.MouseEvent) => {
                              ev.stopPropagation();
                              onSelectThread(thread);
                            }}
                          />
                          <Button
                            kind="ghost"
                            size="sm"
                            hasIconOnly
                            iconDescription={e.isTrashed ? 'Restore' : 'Trash'}
                            renderIcon={e.isTrashed ? Undo : TrashCan}
                            onClick={(ev: React.MouseEvent) => handleThreadAction('trash', thread, ev)}
                          />
                          <Button
                            kind="ghost"
                            size="sm"
                            hasIconOnly
                            iconDescription={isUnread ? 'Mark as read' : 'Mark as unread'}
                            renderIcon={isUnread ? EmailIcon : EmailNew}
                            onClick={(ev: React.MouseEvent) => handleThreadAction('readToggle', thread, ev)}
                          />
                        </div>
                      </div>
                      <div className="thread-item__snippet">{decodeEntities(e.snippet)}</div>
                    </div>
                  );
                })}
              </div>

              {/* The batch is never hidden: this line always says how much of
                  the group is on screen. */}
              <div className="review-group__footer">
                <span className="review-group__showing">
                  {failed
                    ? `Could not load — showing ${showing} of ${total} ${noun}`
                    : `Showing ${showing} of ${total} ${noun}`}
                </span>
                {showing < total &&
                  (loadingMore ? (
                    <InlineLoading description="Loading…" status="active" />
                  ) : (
                    <Button kind="ghost" size="sm" onClick={loadMore}>
                      {failed ? 'Retry' : `Load ${Math.min(PAGE_SIZE, total - showing)} more`}
                    </Button>
                  ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
