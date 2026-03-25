import { useEffect, useState, useMemo, useCallback } from 'react';
import { SideNav, SideNavItems, SideNavLink, Tag } from '@carbon/react';
import { Dashboard, TaskComplete, UserMultiple, Events, Calendar, Email, Settings, Partnership, Activity } from '@carbon/icons-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUIStore } from '../../store/uiStore';
import { dashboardApi, type NavCounts } from '../../api/dashboard';
import { useEmailWebSocket } from '../../hooks/useEmailWebSocket';
import { MailvizLogo } from '../shared/MailvizLogo';

function formatBadge(count: number): string {
  if (count >= 1000) return `${Math.floor(count / 1000)}k`;
  return String(count);
}

export function AppSideNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const sideNavOpen = useUIStore((s) => s.sideNavOpen);
  const [counts, setCounts] = useState<NavCounts>({
    unreadEmails: 0, overdueTasks: 0, expiringDeals: 0, eventsToday: 0,
  });

  const refreshCounts = useCallback(() => {
    dashboardApi.getNavCounts().then(({ data: res }) => {
      setCounts(res.data);
    }).catch(() => {});
  }, []);

  // Real-time: refresh on email/calendar/task/deal events
  const wsHandlers = useMemo(() => ({
    'emails:synced': () => refreshCounts(),
    'email:updated': () => refreshCounts(),
    'email:deleted': () => refreshCounts(),
    'calendar:synced': () => refreshCounts(),
    'task:shared': () => refreshCounts(),
    'deal:shared': () => refreshCounts(),
  }), [refreshCounts]);
  useEmailWebSocket(wsHandlers);

  useEffect(() => {
    refreshCounts();
    const interval = setInterval(refreshCounts, 60_000);
    return () => clearInterval(interval);
  }, [refreshCounts]);

  return (
    <SideNav
      aria-label="Side navigation"
      expanded={sideNavOpen}
      isFixedNav
    >
      <SideNavItems>
        <SideNavLink
          renderIcon={Dashboard}
          isActive={location.pathname === '/'}
          onClick={() => navigate('/')}
        >
          Dashboard
        </SideNavLink>
        <SideNavLink
          renderIcon={TaskComplete}
          isActive={location.pathname === '/tasks'}
          onClick={() => navigate('/tasks')}
        >
          Tasks
          {counts.overdueTasks > 0 && (
            <Tag size="sm" type="red" className="nav-badge">
              {formatBadge(counts.overdueTasks)}
            </Tag>
          )}
        </SideNavLink>
        <SideNavLink
          renderIcon={UserMultiple}
          isActive={location.pathname.startsWith('/customers')}
          onClick={() => navigate('/customers')}
        >
          Companies
        </SideNavLink>
        <SideNavLink
          renderIcon={Events}
          isActive={location.pathname.startsWith('/contacts')}
          onClick={() => navigate('/contacts')}
        >
          Contacts
        </SideNavLink>
        <SideNavLink
          renderIcon={Partnership}
          isActive={location.pathname.startsWith('/deals')}
          onClick={() => navigate('/deals')}
        >
          Deals
          {counts.expiringDeals > 0 && (
            <Tag size="sm" type="warm-gray" className="nav-badge">
              {formatBadge(counts.expiringDeals)}
            </Tag>
          )}
        </SideNavLink>
        <SideNavLink
          renderIcon={Calendar}
          isActive={location.pathname === '/calendar'}
          onClick={() => navigate('/calendar')}
        >
          Calendar
          {counts.eventsToday > 0 && (
            <Tag size="sm" type="teal" className="nav-badge">
              {formatBadge(counts.eventsToday)}
            </Tag>
          )}
        </SideNavLink>
        <SideNavLink
          renderIcon={Email}
          isActive={location.pathname === '/mail'}
          onClick={() => navigate('/mail')}
        >
          Mail
          {counts.unreadEmails > 0 && (
            <Tag size="sm" type="blue" className="nav-badge">
              {formatBadge(counts.unreadEmails)}
            </Tag>
          )}
        </SideNavLink>
        <SideNavLink
          renderIcon={Activity}
          isActive={location.pathname === '/activity'}
          onClick={() => navigate('/activity')}
        >
          Activity Log
        </SideNavLink>
        <SideNavLink
          renderIcon={Settings}
          isActive={location.pathname === '/settings'}
          onClick={() => navigate('/settings')}
        >
          Settings
        </SideNavLink>
      </SideNavItems>
      <div className="sidebar-logo-container">
        <MailvizLogo size={140} variant="animated" />
      </div>
    </SideNav>
  );
}
