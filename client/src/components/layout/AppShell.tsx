import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Theme } from '@carbon/react';
import { AppHeader } from './AppHeader';
import { AppSideNav } from './AppSideNav';
import { NotificationContainer } from '../shared/NotificationContainer';
import { MailvizLogo } from '../shared/MailvizLogo';
import { useUIStore } from '../../store/uiStore';

export function AppShell() {
  const theme = useUIStore((s) => s.theme);

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
        <div className="sidebar-logo-float">
          <MailvizLogo size={140} variant="animated" />
        </div>
      </div>
    </Theme>
  );
}
