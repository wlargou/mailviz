import { SkeletonText, Button } from '@carbon/react';
import { ArrowRight } from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import type { DashboardStats } from '../../types/dashboard';
import { EmptyState } from '../shared/EmptyState';

interface RecentEmailsProps {
  stats: DashboardStats | null;
  loading: boolean;
  onEmailClick?: (threadId: string, subject: string) => void;
}

export function RecentEmails({ stats, loading, onEmailClick }: RecentEmailsProps) {
  const navigate = useNavigate();

  if (loading || !stats) {
    return (
      <div>
        <SkeletonText paragraph lineCount={3} />
      </div>
    );
  }

  const { emails } = stats;

  if (emails.recentEmails.length === 0) {
    return <EmptyState size="sm" title="No recent emails" />;
  }

  return (
    <div className="dashboard-item-list">
      {emails.recentEmails.slice(0, 5).map((email, idx) => (
        <button
          key={email.threadId || idx}
          type="button"
          className={`dashboard-item dashboard-item--email${!email.isRead ? ' dashboard-item--unread' : ''}`}
          aria-label={`${email.subject || '(No subject)'}, from ${email.fromName || email.from}${!email.isRead ? ', unread' : ''}`}
          onClick={() => {
            if (onEmailClick && email.threadId) onEmailClick(email.threadId, email.subject || '(No subject)');
            else navigate('/mail');
          }}
        >
          <span className="dashboard-item__time">
            {formatDistanceToNow(new Date(email.receivedAt), { addSuffix: false })}
          </span>
          <span className="dashboard-item__info">
            <span className="dashboard-item__title">{email.subject || '(No subject)'}</span>
            <span className="dashboard-item__sub">{email.fromName || email.from}</span>
          </span>
        </button>
      ))}
      <Button kind="ghost" size="sm" renderIcon={ArrowRight} className="dashboard-item-list__view-all" onClick={() => navigate('/mail')}>
        View all emails
      </Button>
    </div>
  );
}
