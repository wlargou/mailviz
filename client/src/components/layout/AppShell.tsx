import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Theme } from '@carbon/react';
import { AppHeader } from './AppHeader';
import { AppSideNav } from './AppSideNav';
import { NotificationContainer } from '../shared/NotificationContainer';
import { useUIStore } from '../../store/uiStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useEmailWebSocket } from '../../hooks/useEmailWebSocket';
import type { AppNotification } from '../../api/notifications';

function mapNotificationKind(type: string): 'error' | 'warning' | 'info' {
  if (type.includes('OVERDUE') || type.includes('EXPIRED')) return 'error';
  if (type.includes('DUE_SOON') || type.includes('EXPIRING') || type.includes('STARTING'))
    return 'warning';
  return 'info';
}

export function AppShell() {
  const theme = useUIStore((s) => s.theme);
  const addToast = useUIStore((s) => s.addNotification);
  const addRealtime = useNotificationStore((s) => s.addRealtime);

  // Listen for real-time notification events via WebSocket
  useEmailWebSocket({
    'notification:new': (data: AppNotification) => {
      addRealtime(data);
      addToast({
        kind: mapNotificationKind(data.type),
        title: data.title,
        subtitle: data.message || undefined,
      });
    },
  });

  // Apply theme to document body so portalled elements (menus, modals) inherit it
  useEffect(() => {
    document.documentElement.setAttribute('data-carbon-theme', theme);
  }, [theme]);

  return (
    <Theme theme={theme}>
      <div data-carbon-theme={theme}>
        <AppHeader />
        <div className="app-container">
          <AppSideNav />
          <main className="app-content">
            <Outlet />
          </main>
        </div>
        <NotificationContainer />
      </div>
    </Theme>
  );
}
