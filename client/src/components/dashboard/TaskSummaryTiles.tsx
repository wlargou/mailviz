import { SkeletonText } from '@carbon/react';
import { useNavigate } from 'react-router-dom';
import { TaskComplete, Checkmark, WarningAlt, ChartColumn, Email, Calendar } from '@carbon/icons-react';
import type { DashboardStats } from '../../types/dashboard';

interface TaskSummaryTilesProps {
  stats: DashboardStats | null;
  loading: boolean;
}

export function TaskSummaryTiles({ stats, loading }: TaskSummaryTilesProps) {
  const navigate = useNavigate();

  if (loading || !stats) {
    return (
      <div className="metric-tiles">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div className="metric-tile" key={i}>
            <SkeletonText heading width="60%" />
            <SkeletonText width="40%" />
          </div>
        ))}
      </div>
    );
  }

  const { tasks, emails, calendar } = stats;

  return (
    <div className="metric-tiles">
      <div className="metric-tile metric-tile--tasks" onClick={() => navigate('/tasks')}>
        <div className="metric-tile__header">
          <span className="metric-tile__label">Total Tasks</span>
          <span className="metric-tile__icon">
            <TaskComplete size={16} style={{ color: 'var(--accent-tasks)' }} />
          </span>
        </div>
        <div className="metric-tile__value">{tasks.total}</div>
        <div className="metric-tile__helper">{tasks.inProgress} in progress</div>
      </div>

      <div className="metric-tile metric-tile--completed" onClick={() => navigate('/tasks?status=DONE')}>
        <div className="metric-tile__header">
          <span className="metric-tile__label">Completed</span>
          <span className="metric-tile__icon">
            <Checkmark size={16} style={{ color: 'var(--accent-completed)' }} />
          </span>
        </div>
        <div className="metric-tile__value">{tasks.completed}</div>
        <div className="metric-tile__helper">
          {tasks.total > 0 ? Math.round((tasks.completed / tasks.total) * 100) : 0}% completion rate
        </div>
      </div>

      <div className="metric-tile metric-tile--overdue" onClick={() => navigate('/tasks?overdue=true')}>
        <div className="metric-tile__header">
          <span className="metric-tile__label">Overdue</span>
          <span className="metric-tile__icon">
            <WarningAlt size={16} style={{ color: 'var(--accent-overdue)' }} />
          </span>
        </div>
        <div className="metric-tile__value metric-tile__value--danger">{tasks.overdue}</div>
        <div className="metric-tile__helper">tasks past due date</div>
      </div>

      <div className="metric-tile metric-tile--priority" onClick={() => navigate('/tasks?priority=HIGH')}>
        <div className="metric-tile__header">
          <span className="metric-tile__label">By Priority</span>
          <span className="metric-tile__icon">
            <ChartColumn size={16} style={{ color: 'var(--accent-priority)' }} />
          </span>
        </div>
        <div className="priority-breakdown">
          <div className="priority-item">
            <span className="priority-dot" style={{ backgroundColor: 'var(--cds-support-error)' }} />
            <span>{tasks.byPriority.URGENT || 0}</span>
          </div>
          <div className="priority-item">
            <span className="priority-dot" style={{ backgroundColor: 'var(--cds-support-warning)' }} />
            <span>{tasks.byPriority.HIGH || 0}</span>
          </div>
          <div className="priority-item">
            <span className="priority-dot" style={{ backgroundColor: 'var(--cds-support-caution-minor)' }} />
            <span>{tasks.byPriority.MEDIUM || 0}</span>
          </div>
          <div className="priority-item">
            <span className="priority-dot" style={{ backgroundColor: 'var(--cds-link-primary)' }} />
            <span>{tasks.byPriority.LOW || 0}</span>
          </div>
        </div>
      </div>

      <div className="metric-tile metric-tile--email" onClick={() => navigate('/mail?isRead=false')}>
        <div className="metric-tile__header">
          <span className="metric-tile__label">Unread Today</span>
          <span className="metric-tile__icon">
            <Email size={16} style={{ color: 'var(--cds-link-primary)' }} />
          </span>
        </div>
        <div className="metric-tile__value">{emails.unreadTodayCount}</div>
        <div className="metric-tile__helper">{emails.unreadCount} total unread</div>
      </div>

      <div className="metric-tile metric-tile--calendar" onClick={() => navigate('/calendar')}>
        <div className="metric-tile__header">
          <span className="metric-tile__label">Events Today</span>
          <span className="metric-tile__icon">
            <Calendar size={16} style={{ color: 'var(--accent-calendar)' }} />
          </span>
        </div>
        <div className="metric-tile__value">{calendar.eventsToday}</div>
        <div className="metric-tile__helper">
          {calendar.meetingHoursThisWeek > 0
            ? `${calendar.meetingHoursThisWeek}h meetings · ${calendar.eventsThisWeek} this week`
            : `${calendar.eventsThisWeek} this week`}
        </div>
      </div>
    </div>
  );
}
