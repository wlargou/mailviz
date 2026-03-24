import { Tag, Pagination } from '@carbon/react';
import { StarFilled, Attachment } from '@carbon/icons-react';
import { formatDistanceToNow } from 'date-fns';
import type { EmailThread } from '../../types/email';

const entityEl = typeof document !== 'undefined' ? document.createElement('textarea') : null;
function decodeEntities(text: string | null | undefined): string {
  if (!text || !entityEl) return '';
  entityEl.innerHTML = text;
  return entityEl.value;
}

interface ThreadItemListProps {
  threads: EmailThread[];
  totalItems?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number, pageSize: number) => void;
  onThreadClick: (threadId: string, subject: string) => void;
  emptyMessage?: string;
  loading?: boolean;
}

export function ThreadItemList({
  threads,
  totalItems,
  page = 1,
  pageSize = 10,
  onPageChange,
  onThreadClick,
  emptyMessage = 'No emails',
  loading,
}: ThreadItemListProps) {
  if (threads.length === 0 && !loading) {
    return <div className="card-empty">{emptyMessage}</div>;
  }

  return (
    <div className="thread-item-list-embedded">
      {threads.map((thread) => {
        const e = thread.latestEmail;
        const isUnread = thread.unreadCount > 0;

        return (
          <div
            key={thread.threadId || e.id}
            role="button"
            tabIndex={0}
            className={`thread-item${isUnread ? ' thread-item--unread' : ' thread-item--read'}${e.customer?.isVip ? ' thread-item--vip' : e.customer?.isInternal ? ' thread-item--internal' : ''}`}
            onClick={() => onThreadClick(thread.threadId || e.id, e.subject || '(No subject)')}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                onThreadClick(thread.threadId || e.id, e.subject || '(No subject)');
              }
            }}
          >
            <div className="thread-item__top">
              <span className="thread-item__sender">
                {e.contactName || e.fromName || e.from}
              </span>
              <span className="thread-item__subject-inline">
                {decodeEntities(e.subject)}
              </span>
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
            </div>
            <div className="thread-item__snippet">
              {decodeEntities(e.snippet)}
            </div>
          </div>
        );
      })}
      {totalItems != null && onPageChange && totalItems > pageSize && (
        <Pagination
          totalItems={totalItems}
          pageSize={pageSize}
          pageSizes={[10, 20, 50]}
          page={page}
          onChange={({ page: p, pageSize: ps }: { page: number; pageSize: number }) => onPageChange(p, ps)}
        />
      )}
    </div>
  );
}
