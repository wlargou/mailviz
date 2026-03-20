import { Tabs, TabList, Tab, TabPanels, TabPanel, SkeletonText, Button } from '@carbon/react';
import { ArrowRight } from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { TaskStatusTag } from '../shared/TaskStatusTag';
import { PriorityBadge } from '../shared/PriorityBadge';
import type { DashboardStats } from '../../types/dashboard';
import type { Task } from '../../types/task';

interface RecentActivityProps {
  stats: DashboardStats | null;
  loading: boolean;
  onEmailClick?: (threadId: string, subject: string) => void;
  onTaskClick?: (task: Task) => void;
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].substring(0, 2).toUpperCase();
  }
  return email.substring(0, 2).toUpperCase();
}

export function RecentActivity({ stats, loading, onEmailClick, onTaskClick }: RecentActivityProps) {
  const navigate = useNavigate();

  if (loading || !stats) {
    return (
      <div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton-row--lg">
            <SkeletonText paragraph lineCount={2} />
          </div>
        ))}
      </div>
    );
  }

  const { emails, tasks } = stats;

  return (
    <Tabs>
      <TabList aria-label="Recent activity tabs">
        <Tab>
          Emails {emails.unreadCount > 0 && <span className="recent-activity__badge">{emails.unreadCount}</span>}
        </Tab>
        <Tab>Tasks</Tab>
      </TabList>
      <TabPanels>
        <TabPanel>
          {emails.recentUnread.length === 0 ? (
            <div className="recent-activity__empty">No unread emails</div>
          ) : (
            <div className="recent-activity__list">
              {emails.recentUnread.map((email, idx) => (
                <div
                  key={email.threadId || idx}
                  className="recent-activity__item"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (onEmailClick && email.threadId) onEmailClick(email.threadId, email.subject || '(No subject)'); else navigate('/mail'); } }}
                  onClick={() => {
                    if (onEmailClick && email.threadId) {
                      onEmailClick(email.threadId, email.subject || '(No subject)');
                    } else {
                      navigate('/mail');
                    }
                  }}
                >
                  <div className="recent-activity__avatar">
                    {getInitials(email.fromName, email.from)}
                  </div>
                  <div className="recent-activity__info">
                    <div className="recent-activity__title">{email.subject || '(No subject)'}</div>
                    <div className="recent-activity__sub">{email.fromName || email.from}</div>
                  </div>
                  <div className="recent-activity__time">
                    {formatDistanceToNow(new Date(email.receivedAt), { addSuffix: true })}
                  </div>
                </div>
              ))}
              <Button kind="ghost" size="sm" renderIcon={ArrowRight} className="recent-activity__view-all" onClick={() => navigate('/mail')}>
                View all emails
              </Button>
            </div>
          )}
        </TabPanel>
        <TabPanel>
          {tasks.recentTasks.length === 0 ? (
            <div className="recent-activity__empty">No tasks yet</div>
          ) : (
            <div className="recent-activity__list">
              {tasks.recentTasks.map((task) => (
                <div
                  key={task.id}
                  className="recent-activity__item"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (onTaskClick) onTaskClick(task as Task); else navigate('/tasks'); } }}
                  onClick={() => {
                    if (onTaskClick) {
                      onTaskClick(task as Task);
                    } else {
                      navigate('/tasks');
                    }
                  }}
                >
                  <div className="recent-activity__task-indicators">
                    <PriorityBadge priority={task.priority} />
                  </div>
                  <div className="recent-activity__info">
                    <div className="recent-activity__title">{task.title}</div>
                    <div className="recent-activity__sub">
                      {task.customer?.name || 'No company'}
                    </div>
                  </div>
                  <div className="recent-activity__status">
                    <TaskStatusTag status={task.status} />
                  </div>
                </div>
              ))}
              <Button kind="ghost" size="sm" renderIcon={ArrowRight} className="recent-activity__view-all" onClick={() => navigate('/tasks')}>
                View all tasks
              </Button>
            </div>
          )}
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}
