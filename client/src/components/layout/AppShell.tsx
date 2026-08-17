import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Theme } from '@carbon/react';
import { AppHeader } from './AppHeader';
import { AppSideNav } from './AppSideNav';
import { OnboardingGate } from '../onboarding/OnboardingGate';
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
  const sideNavOpen = useUIStore((s) => s.sideNavOpen);
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
        {/*
          The rail/expanded distinction drives the content offset from *our* state,
          not from Carbon's classes. Carbon adds `cds--side-nav--expanded` when the
          rail expands on hover, so a selector keyed off that class shifted the
          whole page every time the pointer crossed the nav.
        */}
        <div className={`app-container${sideNavOpen ? '' : ' app-container--nav-rail'}`}>
          <AppSideNav />
          {/*
            `id` and `tabIndex` are what Carbon's SkipToContent targets — without
            them the link has nowhere to land. Keyboard users otherwise tab the
            whole navigation on every page, which the rail makes worse rather than
            better: collapsed, the links are still in the tab order.
          */}
          <main id="main-content" className="app-content" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
        <NotificationContainer />
        {/* Renders nothing for an account that has already been through setup. */}
        <OnboardingGate />
      </div>
    </Theme>
  );
}
