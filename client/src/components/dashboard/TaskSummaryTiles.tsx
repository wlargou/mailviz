import { useState, useEffect } from 'react';
import { Grid, Column, Tile, SkeletonText } from '@carbon/react';
import { useNavigate } from 'react-router-dom';
import { WarningAlt, Email, Calendar, Partnership } from '@carbon/icons-react';
import type { DashboardStats } from '../../types/dashboard';

// Animated counter hook
function useCounter(target: number, duration = 1200, delay = 200) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (target === 0) { setVal(0); return; }
    const timeout = setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setVal(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(timeout);
  }, [target, duration, delay]);
  return val;
}

// Sparkline SVG
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => `${(i / (data.length - 1)) * 200},${40 - (v / max) * 36}`).join(' ');

  return (
    <svg viewBox="0 0 200 40" fill="none" className="kpi-sparkline">
      <defs>
        <linearGradient id={`sg-${color.replace('#', '').replace(/[(),%\s]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.25" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={points} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polygon
        points={`${points} 200,40 0,40`}
        fill={`url(#sg-${color.replace('#', '').replace(/[(),%\s]/g, '')})`}
      />
    </svg>
  );
}

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
            <Tile className="kpi-tile">
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
      iconColor: '#fa4d56',
      sparkData: [] as number[],
      onClick: () => navigate('/tasks?overdue=true'),
    },
    {
      label: 'Unread Today',
      value: emails.unreadTodayCount,
      helper: `${emails.unreadCount.toLocaleString()} total unread`,
      icon: Email,
      iconColor: '#4589ff',
      sparkData: [] as number[],
      onClick: () => navigate('/mail?isRead=false'),
    },
    {
      label: 'Events Today',
      value: calendar.eventsToday,
      helper: `${calendar.meetingHoursThisWeek}h meetings this week`,
      icon: Calendar,
      iconColor: '#42be65',
      sparkData: [] as number[],
      onClick: () => navigate('/calendar'),
    },
    {
      label: 'Expiring Deals',
      value: stats.expiringDeals?.length ?? 0,
      helper: 'in the next 15 days',
      icon: Partnership,
      iconColor: '#f1c21b',
      sparkData: [] as number[],
      onClick: () => navigate('/deals'),
    },
  ];

  return (
    <Grid fullWidth className="dashboard-metrics">
      {metrics.map((m, idx) => {
        const Icon = m.icon;
        return (
          <Column key={m.label} lg={4} md={2} sm={2}>
            <KPITile
              label={m.label}
              value={m.value}
              helper={m.helper}
              icon={Icon}
              iconColor={m.iconColor}
              sparkData={m.sparkData}
              onClick={m.onClick}
              animDelay={idx}
            />
          </Column>
        );
      })}
    </Grid>
  );
}

function KPITile({
  label, value, helper, icon: Icon, iconColor, sparkData, onClick, animDelay,
}: {
  label: string; value: number; helper: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  iconColor: string; sparkData: number[]; onClick: () => void; animDelay: number;
}) {
  const count = useCounter(value, 1000, 200 + animDelay * 100);

  return (
    <div
      className="kpi-tile"
      onClick={onClick}
      style={{ animationDelay: `${animDelay * 0.08}s` }}
    >
      <div className="kpi-tile__accent" style={{ background: `linear-gradient(90deg, ${iconColor}, transparent)` }} />
      <div className="kpi-tile__header">
        <Icon size={14} style={{ color: iconColor }} />
        <span className="kpi-tile__label">{label}</span>
      </div>
      <div className="kpi-tile__value" style={value > 0 && iconColor === '#fa4d56' ? { color: iconColor } : undefined}>
        {count}
      </div>
      <div className="kpi-tile__helper">{helper}</div>
      {sparkData.length > 0 && <Sparkline data={sparkData} color={iconColor} />}
    </div>
  );
}
