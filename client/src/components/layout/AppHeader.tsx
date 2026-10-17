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
import { BrandMark } from '../shared/BrandMark';
import { AboutModal } from '../shared/AboutModal';
import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from '../../brand';

export function AppHeader() {
  const { theme, toggleTheme, sideNavOpen, setSideNavOpen } = useUIStore();
  const logout = useAuthStore((s) => s.logout);
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <Header aria-label={PRODUCT_NAME}>
      <SkipToContent />
      <HeaderMenuButton
        aria-label={sideNavOpen ? 'Close menu' : 'Open menu'}
        onClick={() => setSideNavOpen(!sideNavOpen)}
        isActive={sideNavOpen}
      />
      {/* `prefix=""`: Carbon renders the prefix before the children, so the
          glyph could not lead it. The lockup is composed inside instead. */}
      <HeaderName href="/" prefix="">
        <span className="brand-lockup">
          <BrandMark size={24} />
          <span className="brand-name">{PRODUCT_SHORT_NAME}</span>
        </span>
      </HeaderName>
      <HeaderGlobalBar>
        <GlobalSearch />
        <ConnectionStatus />
        <NotificationBell />
        {/* Next to the connection indicator on purpose: both answer "is what I
            am looking at current", which is the question someone has when they
            reach for either.
            Its tooltip is end-aligned like the two actions after it: the full
            name makes it ~250px wide, and centred on a button 120px from the
            edge it ran past the right side of the window. */}
        <HeaderGlobalAction
          aria-label={`About ${PRODUCT_NAME}`}
          onClick={() => setAboutOpen(true)}
          tooltipAlignment="end"
        >
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
