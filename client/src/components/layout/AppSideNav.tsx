import { useEffect, useState, useMemo, useCallback } from 'react';
import { SideNav, SideNavItems, SideNavLink, Tag } from '@carbon/react';
import { Dashboard, TaskComplete, UserMultiple, Events, Calendar, Email, Settings } from '@carbon/icons-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUIStore } from '../../store/uiStore';
import { emailsApi } from '../../api/emails';
import { useEmailWebSocket } from '../../hooks/useEmailWebSocket';

export function AppSideNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const sideNavOpen = useUIStore((s) => s.sideNavOpen);
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnread = useCallback(() => {
    emailsApi.getUnreadCount().then(({ data: res }) => {
      setUnreadCount(res.data.count);
    }).catch(() => {});
  }, []);

  // Real-time: refresh unread count on any email event
  const wsHandlers = useMemo(() => ({
    'emails:synced': () => refreshUnread(),
    'email:updated': () => refreshUnread(),
    'email:deleted': () => refreshUnread(),
  }), [refreshUnread]);
  useEmailWebSocket(wsHandlers);

  useEffect(() => {
    refreshUnread();
    // Fallback polling every 60s in case WebSocket disconnects
    const interval = setInterval(refreshUnread, 60_000);
    return () => clearInterval(interval);
  }, [refreshUnread]);

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
        </SideNavLink>
        <SideNavLink
          renderIcon={UserMultiple}
          isActive={location.pathname.startsWith('/customers')}
          onClick={() => navigate('/customers')}
        >
          Customers
        </SideNavLink>
        <SideNavLink
          renderIcon={Events}
          isActive={location.pathname.startsWith('/contacts')}
          onClick={() => navigate('/contacts')}
        >
          Contacts
        </SideNavLink>
        <SideNavLink
          renderIcon={Calendar}
          isActive={location.pathname === '/calendar'}
          onClick={() => navigate('/calendar')}
        >
          Calendar
        </SideNavLink>
        <SideNavLink
          renderIcon={Email}
          isActive={location.pathname === '/mail'}
          onClick={() => navigate('/mail')}
        >
          Mail
          {unreadCount > 0 && (
            <Tag size="sm" type="blue" className="mail-unread-badge">
              {unreadCount > 99 ? '99+' : unreadCount}
            </Tag>
          )}
        </SideNavLink>
        <SideNavLink
          renderIcon={Settings}
          isActive={location.pathname === '/settings'}
          onClick={() => navigate('/settings')}
        >
          Settings
        </SideNavLink>
      </SideNavItems>
    </SideNav>
  );
}
