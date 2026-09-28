import { useEffect, useState, useMemo, useCallback } from 'react';
import { SideNav, SideNavItems, SideNavLink, Tag } from '@carbon/react';
import { Dashboard, TaskComplete, UserMultiple, Events, Calendar, Email, Settings, Partnership, Activity, Sunrise, Document } from '@carbon/icons-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUIStore } from '../../store/uiStore';
import { dashboardApi, type NavCounts } from '../../api/dashboard';
import { useEmailWebSocket } from '../../hooks/useEmailWebSocket';

/**
 * A badge counts what can be finished today, so it never needs to be large;
 * past 99 it says "99+" rather than "11k", which was a number nobody could act on.
 */
function formatBadge(count: number): string {
  return count > 99 ? '99+' : String(count);
}

export function AppSideNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const sideNavOpen = useUIStore((s) => s.sideNavOpen);
  const [counts, setCounts] = useState<NavCounts>({
    unreadEmails: 0, overdueTasks: 0, expiringDeals: 0, eventsToday: 0, repliesOwed: 0, rfpsAtRisk: 0,
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
  // Refetch on reconnect — events broadcast while the socket was down are lost.
  useEmailWebSocket(wsHandlers, { onReconnect: () => refreshCounts() });

  useEffect(() => {
    refreshCounts();
    const interval = setInterval(refreshCounts, 60_000);
    return () => clearInterval(interval);
  }, [refreshCounts]);

  return (
    <SideNav
      aria-label="Side navigation"
      expanded={sideNavOpen}
      // A rail rather than nothing. Collapsing used to hide navigation outright,
      // so reaching another page meant reopening the panel first; Carbon's rail
      // keeps the icons at 48px and expands over the content on hover or focus.
      // That is what makes the collapsed state usable rather than just narrow.
      isRail
      isChildOfHeader
      href="#main-content"
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
          renderIcon={Sunrise}
          isActive={location.pathname === '/my-day'}
          onClick={() => navigate('/my-day')}
        >
          My Day
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
            <Tag size="sm" type="cool-gray" className="nav-badge">
              {formatBadge(counts.expiringDeals)}
            </Tag>
          )}
        </SideNavLink>
        <SideNavLink
          renderIcon={Document}
          isActive={location.pathname === '/rfps'}
          onClick={() => navigate('/rfps')}
        >
          RFPs
          {counts.rfpsAtRisk > 0 && (
            <Tag size="sm" type="red" className="nav-badge" title={`${counts.rfpsAtRisk} at risk`}>
              {formatBadge(counts.rfpsAtRisk)}
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
            <Tag size="sm" type="cool-gray" className="nav-badge">
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
          {/* People waiting on a reply — not unread mail, which ran to 11k. */}
          {counts.repliesOwed > 0 && (
            <Tag size="sm" type="cool-gray" className="nav-badge" title={`${counts.repliesOwed} waiting on your reply`}>
              {formatBadge(counts.repliesOwed)}
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
      {/* No animated logo down here: it moved on every page, pulled the eye
          from the work, and the header already carries the mark. */}
    </SideNav>
  );
}
