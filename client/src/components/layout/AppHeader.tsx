import { useState } from 'react';
import {
  Header,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenuButton,
  HeaderName,
  SkipToContent,
} from '@carbon/react';
import { Light, Asleep, Logout, Information } from '@carbon/icons-react';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';
import { ConnectionStatus } from './ConnectionStatus';
import { MailvizLogo } from '../shared/MailvizLogo';
import { AboutModal } from '../shared/AboutModal';

export function AppHeader() {
  const { theme, toggleTheme, sideNavOpen, setSideNavOpen } = useUIStore();
  const logout = useAuthStore((s) => s.logout);
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <Header aria-label="Mailviz Productivity Hub">
      <SkipToContent />
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
        <ConnectionStatus />
        <NotificationBell />
        {/* Next to the connection indicator on purpose: both answer "is what I
            am looking at current", which is the question someone has when they
            reach for either. */}
        <HeaderGlobalAction aria-label="About Mailviz" onClick={() => setAboutOpen(true)}>
          <Information size={20} />
        </HeaderGlobalAction>
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
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </Header>
  );
}
