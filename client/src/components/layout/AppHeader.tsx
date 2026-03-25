import {
  Header,
  HeaderName,
  HeaderMenuButton,
  HeaderGlobalBar,
  HeaderGlobalAction,
} from '@carbon/react';
import { Light, Asleep, Logout } from '@carbon/icons-react';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';
import { MailvizLogo } from '../shared/MailvizLogo';

export function AppHeader() {
  const { theme, toggleTheme, sideNavOpen, setSideNavOpen } = useUIStore();
  const logout = useAuthStore((s) => s.logout);

  return (
    <Header aria-label="Mailviz Productivity Hub">
      <HeaderMenuButton
        aria-label={sideNavOpen ? 'Close menu' : 'Open menu'}
        onClick={() => setSideNavOpen(!sideNavOpen)}
        isActive={sideNavOpen}
      />
      <HeaderName href="/" prefix="" className="mailviz-header-name">
        <MailvizLogo size={26} />
        <span>Mailviz</span>
      </HeaderName>
      <HeaderGlobalBar>
        <GlobalSearch />
        <NotificationBell />
        <HeaderGlobalAction
          aria-label="Toggle theme"
          onClick={toggleTheme}
          tooltipAlignment="end"
        >
          {theme === 'g10' ? <Asleep size={20} /> : <Light size={20} />}
        </HeaderGlobalAction>
        <HeaderGlobalAction
          aria-label="Sign out"
          onClick={logout}
          tooltipAlignment="end"
        >
          <Logout size={20} />
        </HeaderGlobalAction>
      </HeaderGlobalBar>
    </Header>
  );
}
