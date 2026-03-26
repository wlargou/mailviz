import { Grid, Column, ClickableTile, SkeletonText } from '@carbon/react';
import { useNavigate } from 'react-router-dom';
import { WarningAlt, Email, Calendar, Partnership } from '@carbon/icons-react';
import type { DashboardStats } from '../../types/dashboard';

interface TaskSummaryTilesProps {
  stats: DashboardStats | null;
  loading: boolean;
}

export function TaskSummaryTiles({ stats, loading }: TaskSummaryTilesProps) {
  const navigate = useNavigate();

  if (loading || !stats) {
    return (
      <Grid fullWidth className="dashboard-metrics">
        {[1, 2, 3, 4].map((i) => (
          <Column key={i} lg={4} md={2} sm={2}>
            <ClickableTile className="kpi-tile" disabled>
              <SkeletonText heading width="60%" />
              <SkeletonText width="40%" />
            </ClickableTile>
          </Column>
        ))}
      </Grid>
    );
  }

  const { tasks, emails, calendar } = stats;

  const metrics = [
    {
      label: 'Overdue Tasks',
      value: tasks.overdue,
      helper: 'tasks past due date',
      icon: WarningAlt,
      accentVar: '--cds-support-error',
      onClick: () => navigate('/tasks?overdue=true'),
    },
    {
      label: 'Unread Today',
      value: emails.unreadTodayCount,
      helper: `${emails.unreadCount.toLocaleString()} total unread`,
      icon: Email,
      accentVar: '--cds-link-primary',
      onClick: () => navigate('/mail?isRead=false'),
    },
    {
      label: 'Events Today',
      value: calendar.eventsToday,
      helper: `${calendar.meetingHoursThisWeek}h meetings this week`,
      icon: Calendar,
      accentVar: '--cds-support-success',
      onClick: () => navigate('/calendar'),
    },
    {
      label: 'Expiring Deals',
      value: stats.expiringDeals?.length ?? 0,
      helper: 'in the next 15 days',
      icon: Partnership,
      accentVar: '--cds-support-warning',
      onClick: () => navigate('/deals'),
    },
  ];

  return (
    <Grid fullWidth className="dashboard-metrics">
      {metrics.map((m) => {
        const Icon = m.icon;
        const color = `var(${m.accentVar})`;
        return (
          <Column key={m.label} lg={4} md={2} sm={2}>
            <ClickableTile className="kpi-tile" onClick={m.onClick}>
              <div className="kpi-tile__header">
                <Icon size={16} style={{ color }} />
                <span className="kpi-tile__label">{m.label}</span>
              </div>
              <div
                className="kpi-tile__value"
                style={m.value > 0 && m.accentVar === '--cds-support-error' ? { color } : undefined}
              >
                {m.value}
              </div>
              <div className="kpi-tile__helper">{m.helper}</div>
            </ClickableTile>
          </Column>
        );
      })}
    </Grid>
  );
}
