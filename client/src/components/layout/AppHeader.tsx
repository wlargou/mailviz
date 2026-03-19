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
      <HeaderName href="/" prefix="">
        Mailviz
      </HeaderName>
      <HeaderGlobalBar>
        <GlobalSearch />
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
