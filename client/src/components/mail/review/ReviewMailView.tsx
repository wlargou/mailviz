import { useEffect, useState, useMemo, useCallback } from 'react';
import { Button, Tag, Toggle, SkeletonText } from '@carbon/react';
import { SidePanel } from '@carbon/ibm-products';
import {
  ArrowLeft,
  StarFilled,
  Star,
  Attachment,
  Email as EmailIcon,
  EmailNew,
  ReplyAll,
  TrashCan,
  Undo,
  Task,
  ChevronDown,
  ChevronUp,
} from '@carbon/icons-react';
import { formatDistanceToNow } from 'date-fns';
import { emailsApi } from '../../../api/emails';
import { ThreadDetail } from '../ThreadDetail';
import type { EmailThread } from '../../../types/email';
import type { ReviewPeriod } from './ReviewPage';

// Decode HTML entities in snippets
const entityEl = document.createElement('textarea');
function decodeEntities(text: string | null | undefined): string {
  if (!text) return '';
  entityEl.innerHTML = text;
  return entityEl.value;
}

interface CustomerGroup {
  customerId: string | null;
  customerName: string;
  customerLogoUrl: string | null;
  isVip: boolean;
  threads: EmailThread[];
}

interface Props {
  period: ReviewPeriod;
  customerIds: string[];
  includeUncategorized: boolean;
  onBack: () => void;
}

export function ReviewMailView({ period, customerIds, includeUncategorized, onBack }: Props) {
  const [allThreads, setAllThreads] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const fetchAllThreads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Fetch threads for selected customers
      const params: Record<string, string> = {
        dateAfter: period.dateAfter,
        dateBefore: period.dateBefore,
        limit: '500',
      };
      if (customerIds.length > 0 && !includeUncategorized) {
        params.customerId = customerIds.join(',');
      }
      const res = await emailsApi.getThreads(params);
      let threads = res.data.data;

      // Client-side filter: only keep selected customers + optionally uncategorized
      if (customerIds.length > 0 || includeUncategorized) {
        const idSet = new Set(customerIds);
        threads = threads.filter((t) => {
          const cid = t.latestEmail.customerId;
          if (cid && idSet.has(cid)) return true;
          if (!cid && includeUncategorized) return true;
          return false;
        });
      }

      setAllThreads(threads);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, [period, customerIds, includeUncategorized]);

  useEffect(() => {
    fetchAllThreads();
  }, [fetchAllThreads]);

  const filteredThreads = useMemo(() => {
    if (!unreadOnly) return allThreads;
    return allThreads.filter((t) => t.unreadCount > 0);
  }, [allThreads, unreadOnly]);

  const groups = useMemo(() => {
    const map = new Map<string, CustomerGroup>();

    for (const thread of filteredThreads) {
      const cid = thread.latestEmail.customerId ?? '__uncategorized__';
      if (!map.has(cid)) {
        const customer = thread.latestEmail.customer;
        map.set(cid, {
          customerId: cid === '__uncategorized__' ? null : cid,
          customerName: customer?.name ?? 'Uncategorized',
          customerLogoUrl: customer?.logoUrl ?? null,
          isVip: customer?.isVip ?? false,
          threads: [],
        });
      }
      map.get(cid)!.threads.push(thread);
    }

    // Sort groups: VIP first, then by thread count desc
    return Array.from(map.values()).sort((a, b) => {
      if (a.isVip !== b.isVip) return a.isVip ? -1 : 1;
      return b.threads.length - a.threads.length;
    });
  }, [filteredThreads]);

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleThreadAction = async (action: string, thread: EmailThread, ev: React.MouseEvent) => {
    ev.stopPropagation();
    const e = thread.latestEmail;
    try {
      if (action === 'star') await emailsApi.toggleStar(e.id);
      else if (action === 'trash') {
        if (e.isTrashed) await emailsApi.untrash(e.id);
        else await emailsApi.trash(e.id);
      } else if (action === 'readToggle') {
        if (thread.unreadCount > 0) await emailsApi.markAsRead(e.id);
        else await emailsApi.markAsUnread(e.id);
      }
      fetchAllThreads(true);
    } catch {
      // silent
    }
  };

  const selectedThreadData = allThreads.find((t) => t.threadId === selectedThread);

  const totalUnread = allThreads.reduce((sum, t) => sum + t.unreadCount, 0);

  return (
    <div className="review-mail">
      <div className="page-header page-header--padded">
        <div className="page-header__info">
          <Button
            kind="ghost"
            size="sm"
            renderIcon={ArrowLeft}
            onClick={onBack}
            className="review-back-btn"
          >
            Back
          </Button>
          <h1>Review — {period.label}</h1>
          <p className="page-header__subtitle">
            {filteredThreads.length} threads &middot; {totalUnread} unread
          </p>
        </div>
        <div className="page-header__actions">
          <Toggle
            id="review-unread-toggle"
            size="sm"
            labelText=""
            hideLabel
            labelA="All emails"
            labelB="Unread only"
            toggled={unreadOnly}
            onToggle={(checked: boolean) => setUnreadOnly(checked)}
          />
        </div>
      </div>

      {loading ? (
        <div className="review-mail__skeleton">
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ padding: '1rem' }}>
              <SkeletonText heading width="30%" />
              <SkeletonText paragraph lineCount={3} />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="review-customers__empty">
          <EmailIcon size={48} />
          <p>{unreadOnly ? 'No unread emails in this period' : 'No emails found'}</p>
        </div>
      ) : (
        <div className="review-mail__groups">
          {groups.map((group) => {
            const gid = group.customerId ?? '__uncategorized__';
            const isCollapsed = collapsedGroups.has(gid);

            return (
              <div key={gid} className="review-group">
                <div
                  className="review-group__header"
                  onClick={() => toggleGroup(gid)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(gid); } }}
                >
                  <div className="review-group__title">
                    {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                    {group.customerLogoUrl && (
                      <img src={group.customerLogoUrl} alt="" className="review-group__logo" />
                    )}
                    <span className="review-group__name">{group.customerName}</span>
                    {group.isVip && <StarFilled size={14} className="vip-star" />}
                    <Tag size="sm" type="cool-gray">{group.threads.length}</Tag>
                    {group.threads.reduce((s, t) => s + t.unreadCount, 0) > 0 && (
                      <Tag size="sm" type="blue">
                        {group.threads.reduce((s, t) => s + t.unreadCount, 0)} unread
                      </Tag>
                    )}
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="thread-list">
                    {group.threads.map((thread) => {
                      const e = thread.latestEmail;
                      const isUnread = thread.unreadCount > 0;
                      const isSelected = thread.threadId === selectedThread;

                      return (
                        <div
                          key={thread.threadId}
                          role="button"
                          tabIndex={0}
                          className={`thread-item${isUnread ? ' thread-item--unread' : ' thread-item--read'}${e.customer?.isVip ? ' thread-item--vip' : e.customer?.isInternal ? ' thread-item--internal' : ''}${isSelected ? ' thread-item--selected' : ''}`}
                          onClick={() => setSelectedThread(thread.threadId)}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter' || ev.key === ' ') {
                              ev.preventDefault();
                              setSelectedThread(thread.threadId);
                            }
                          }}
                        >
                          <div className="thread-item__top">
                            <span className="thread-item__sender">
                              {e.contactName || e.fromName || e.from}
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
                                  setSelectedThread(thread.threadId);
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
                )}
              </div>
            );
          })}
        </div>
      )}

      <SidePanel
        open={!!selectedThread}
        onRequestClose={() => setSelectedThread(null)}
        title={selectedThreadData?.latestEmail.subject || 'Thread'}
        size="lg"
        className="mail-page__side-panel"
      >
        {selectedThread && (
          <ThreadDetail
            threadId={selectedThread}
            onEmailAction={() => fetchAllThreads(true)}
          />
        )}
      </SidePanel>
    </div>
  );
}
