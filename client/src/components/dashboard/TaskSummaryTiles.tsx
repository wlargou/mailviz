import { useEffect, useState } from 'react';
import { Grid, Column, ClickableTile, SkeletonText } from '@carbon/react';
import { useNavigate } from 'react-router-dom';
import { WarningAlt, Email, Calendar, Document } from '@carbon/icons-react';
import { dashboardApi, type NavCounts } from '../../api/dashboard';
import type { DashboardStats } from '../../types/dashboard';

interface TaskSummaryTilesProps {
  stats: DashboardStats | null;
  loading: boolean;
}

/**
 * Four numbers, each something that can be acted on today. "Unread today"
 * (0, above 11,855 total unread) and "Expiring deals" (0, with no deals)
 * took half the row and prompted nothing.
 */
export function TaskSummaryTiles({ stats, loading }: TaskSummaryTilesProps) {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<NavCounts | null>(null);
  useEffect(() => {
    dashboardApi.getNavCounts().then(({ data }) => setCounts(data.data)).catch(() => {});
  }, []);

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

  const { tasks, calendar } = stats;

  const metrics = [
    {
      label: 'Late tasks',
      value: tasks.overdue,
      helper: 'past their due date',
      icon: WarningAlt,
      accentVar: '--cds-support-error',
      onClick: () => navigate('/tasks?overdue=true'),
    },
    {
      label: 'Replies owed',
      value: counts?.repliesOwed ?? 0,
      helper: 'people waiting on you',
      icon: Email,
      accentVar: '--cds-link-primary',
      onClick: () => navigate('/mail?folder=to-reply'),
    },
    {
      label: 'Meetings today',
      value: calendar.eventsToday,
      helper: `${calendar.meetingHoursThisWeek}h of meetings this week`,
      icon: Calendar,
      accentVar: '--cds-support-success',
      onClick: () => navigate('/calendar'),
    },
    {
      label: 'Tenders at risk',
      value: counts?.rfpsAtRisk ?? 0,
      helper: 'readiness behind the clock',
      icon: Document,
      accentVar: '--cds-support-error',
      onClick: () => navigate('/pursuits'),
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
