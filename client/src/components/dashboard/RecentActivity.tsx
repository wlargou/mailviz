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

export function RecentActivity({ stats, loading, onEmailClick, onTaskClick }: RecentActivityProps) {
  const navigate = useNavigate();

  if (loading || !stats) {
    return (
      <div>
        <SkeletonText paragraph lineCount={3} />
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
          {emails.recentEmails.length === 0 ? (
            <div className="card-empty">No recent emails</div>
          ) : (
            <div className="dashboard-item-list">
              {emails.recentEmails.slice(0, 5).map((email, idx) => (
                <div
                  key={email.threadId || idx}
                  className={`dashboard-item dashboard-item--email${!email.isRead ? ' dashboard-item--unread' : ''}`}
                  onClick={() => {
                    if (onEmailClick && email.threadId) onEmailClick(email.threadId, email.subject || '(No subject)');
                    else navigate('/mail');
                  }}
                >
                  <div className="dashboard-item__time">
                    {formatDistanceToNow(new Date(email.receivedAt), { addSuffix: false })}
                  </div>
                  <div className="dashboard-item__info">
                    <span className="dashboard-item__title">{email.subject || '(No subject)'}</span>
                  </div>
                  <span className="dashboard-item__sender">{email.fromName || email.from}</span>
                </div>
              ))}
              <Button kind="ghost" size="sm" renderIcon={ArrowRight} className="dashboard-item-list__view-all" onClick={() => navigate('/mail')}>
                View all emails
              </Button>
            </div>
          )}
        </TabPanel>
        <TabPanel>
          {tasks.recentTasks.length === 0 ? (
            <div className="card-empty">No tasks yet</div>
          ) : (
            <div className="dashboard-item-list">
              {tasks.recentTasks.map((task) => (
                <div
                  key={task.id}
                  className="dashboard-item dashboard-item--task"
                  onClick={() => {
                    if (onTaskClick) onTaskClick(task as Task);
                    else navigate('/tasks');
                  }}
                >
                  <div className="dashboard-item__badge">
                    <PriorityBadge priority={task.priority} />
                  </div>
                  <div className="dashboard-item__info">
                    <span className="dashboard-item__title">{task.title}</span>
                    <span className="dashboard-item__sub">{task.customer?.name || 'No company'}</span>
                  </div>
                  <div className="dashboard-item__tag">
                    <TaskStatusTag status={task.status} />
                  </div>
                </div>
              ))}
              <Button kind="ghost" size="sm" renderIcon={ArrowRight} className="dashboard-item-list__view-all" onClick={() => navigate('/tasks')}>
                View all tasks
              </Button>
            </div>
          )}
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}
