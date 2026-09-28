import { InlineLoading } from '@carbon/react';
import { CheckmarkOutline } from '@carbon/icons-react';
import { EmptyState } from '../shared/EmptyState';
import { decodeEntities } from '../../utils/text';
import type { ReplyOwed } from '../../types/email';

/**
 * Who is waiting on the user. The server decides what counts — the latest
 * message in the thread is someone else's, addressed to the user, in the
 * inbox, not automated, in the last two weeks — and sends them oldest first,
 * because the longest wait is the one to clear. Replying takes a thread off
 * the list on the next sync; nothing here has to be dismissed by hand.
 */
interface Props {
  items: ReplyOwed[];
  loading: boolean;
  selectedThread: string | null;
  onOpen: (threadId: string) => void;
  now?: Date;
}

/** How long someone has been waiting, in the largest whole unit that fits. */
export function waitingFor(receivedAt: string, now = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(receivedAt).getTime()) / 60000));
  if (minutes < 60) return minutes <= 1 ? 'a minute' : `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

export function ToReplyList({ items, loading, selectedThread, onOpen, now = new Date() }: Props) {
  if (loading && items.length === 0) {
    return (
      <div className="mail-page__loading">
        <InlineLoading description="Finding who is waiting on you..." />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nobody is waiting on you"
        description="Mail sent to you in the last two weeks has all been answered"
        icon={<CheckmarkOutline size={48} />}
      />
    );
  }
  return (
    <>
      <p className="to-reply__hint">
        The last message in each of these is to you and has no answer yet — longest wait first.
      </p>
      <div className="to-reply-list" role="list">
        {items.map((r) => (
          <div
            key={r.threadId}
            role="listitem"
          >
            <button
              type="button"
              className={`to-reply-item${r.threadId === selectedThread ? ' to-reply-item--selected' : ''}`}
              onClick={() => onOpen(r.threadId)}
            >
              <span className="to-reply-item__from">{r.fromName || r.from}</span>
              <span className="to-reply-item__subject">{decodeEntities(r.subject) || '(No subject)'}</span>
              <span className="to-reply-item__waiting">waiting {waitingFor(r.receivedAt, now)}</span>
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
