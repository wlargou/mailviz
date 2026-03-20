import { Grid, Column, Tile, SkeletonText } from '@carbon/react';
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
            <Tile className="metric-tile">
              <SkeletonText heading width="60%" />
              <SkeletonText width="40%" />
            </Tile>
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
      iconColor: 'var(--cds-support-error)',
      borderColor: 'var(--cds-support-error)',
      valueColor: tasks.overdue > 0 ? 'var(--cds-support-error)' : undefined,
      onClick: () => navigate('/tasks?overdue=true'),
    },
    {
      label: 'Unread Today',
      value: emails.unreadTodayCount,
      helper: `${emails.unreadCount} total unread`,
      icon: Email,
      iconColor: 'var(--cds-link-primary)',
      borderColor: 'var(--cds-link-primary)',
      onClick: () => navigate('/mail?isRead=false'),
    },
    {
      label: 'Events Today',
      value: calendar.eventsToday,
      helper: `${calendar.meetingHoursThisWeek}h meetings · ${calendar.eventsThisWeek} this week`,
      icon: Calendar,
      iconColor: 'var(--cds-support-success)',
      borderColor: 'var(--cds-support-success)',
      onClick: () => navigate('/calendar'),
    },
    {
      label: 'Expiring Deals',
      value: stats.expiringDeals?.length ?? 0,
      helper: 'in the next 15 days',
      icon: Partnership,
      iconColor: 'var(--cds-support-warning)',
      borderColor: 'var(--cds-support-warning)',
      valueColor: (stats.expiringDeals?.length ?? 0) > 0 ? 'var(--cds-support-warning)' : undefined,
      onClick: () => navigate('/deals'),
    },
  ];

  return (
    <Grid fullWidth className="dashboard-metrics">
      {metrics.map((m) => {
        const Icon = m.icon;
        return (
          <Column key={m.label} lg={4} md={2} sm={2}>
            <Tile
              className="metric-tile"
              onClick={m.onClick}
              style={{ borderTopColor: m.borderColor }}
            >
              <div className="metric-tile__header">
                <span className="metric-tile__label">{m.label}</span>
                <Icon size={16} style={{ color: m.iconColor }} />
              </div>
              <div
                className="metric-tile__value"
                style={m.valueColor ? { color: m.valueColor } : undefined}
              >
                {m.value}
              </div>
              <div className="metric-tile__helper">{m.helper}</div>
            </Tile>
          </Column>
        );
      })}
    </Grid>
  );
}
