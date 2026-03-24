import { Tag, Pagination, Button } from '@carbon/react';
import { StarFilled, Star, Attachment, TrashCan, Undo, Email as EmailIcon, EmailNew, ReplyAll, TaskComplete as Task } from '@carbon/icons-react';
import { formatDistanceToNow } from 'date-fns';
import type { EmailThread } from '../../types/email';

const entityEl = typeof document !== 'undefined' ? document.createElement('textarea') : null;
function decodeEntities(text: string | null | undefined): string {
  if (!text || !entityEl) return '';
  entityEl.innerHTML = text;
  return entityEl.value;
}

type ThreadAction = 'star' | 'trash' | 'readToggle' | 'replyAll' | 'convertToTask';

interface ThreadItemListProps {
  threads: EmailThread[];
  totalItems?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number, pageSize: number) => void;
  onThreadClick: (threadId: string, subject: string) => void;
  onThreadAction?: (action: ThreadAction, thread: EmailThread) => void;
  emptyMessage?: string;
  loading?: boolean;
  showActions?: boolean;
}

export function ThreadItemList({
  threads,
  totalItems,
  page = 1,
  pageSize = 10,
  onPageChange,
  onThreadClick,
  onThreadAction,
  emptyMessage = 'No emails',
  loading,
  showActions = true,
}: ThreadItemListProps) {
  if (threads.length === 0 && !loading) {
    return <div className="card-empty">{emptyMessage}</div>;
  }

  const handleAction = (action: ThreadAction, thread: EmailThread, ev: React.MouseEvent) => {
    ev.stopPropagation();
    onThreadAction?.(action, thread);
  };

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
              {showActions && onThreadAction && (
                <div className="thread-item__actions">
                  <Button
                    kind="ghost" size="sm" hasIconOnly
                    iconDescription={e.isStarred ? 'Unstar' : 'Star'}
                    renderIcon={e.isStarred ? StarFilled : Star}
                    className={e.isStarred ? 'thread-action--starred' : ''}
                    onClick={(ev: React.MouseEvent) => handleAction('star', thread, ev)}
                  />
                  <Button
                    kind="ghost" size="sm" hasIconOnly
                    iconDescription="Reply All"
                    renderIcon={ReplyAll}
                    onClick={(ev: React.MouseEvent) => {
                      ev.stopPropagation();
                      onThreadClick(thread.threadId || e.id, e.subject || '(No subject)');
                    }}
                  />
                  <Button
                    kind="ghost" size="sm" hasIconOnly
                    iconDescription={e.isTrashed ? 'Restore' : 'Trash'}
                    renderIcon={e.isTrashed ? Undo : TrashCan}
                    onClick={(ev: React.MouseEvent) => handleAction('trash', thread, ev)}
                  />
                  <Button
                    kind="ghost" size="sm" hasIconOnly
                    iconDescription={isUnread ? 'Mark as read' : 'Mark as unread'}
                    renderIcon={isUnread ? EmailIcon : EmailNew}
                    onClick={(ev: React.MouseEvent) => handleAction('readToggle', thread, ev)}
                  />
                  <Button
                    kind="ghost" size="sm" hasIconOnly
                    iconDescription="Convert to task"
                    renderIcon={Task}
                    onClick={(ev: React.MouseEvent) => handleAction('convertToTask', thread, ev)}
                  />
                </div>
              )}
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
