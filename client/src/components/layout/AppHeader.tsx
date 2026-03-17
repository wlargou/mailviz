import {
  Header,
  HeaderName,
  HeaderMenuButton,
  HeaderGlobalBar,
  HeaderGlobalAction,
} from '@carbon/react';
import { Light, Asleep } from '@carbon/icons-react';
import { useUIStore } from '../../store/uiStore';

export function AppHeader() {
  const { theme, toggleTheme, sideNavOpen, setSideNavOpen } = useUIStore();

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
        <HeaderGlobalAction
          aria-label="Toggle theme"
          onClick={toggleTheme}
          tooltipAlignment="end"
        >
          {theme === 'g10' ? <Asleep size={20} /> : <Light size={20} />}
        </HeaderGlobalAction>
      </HeaderGlobalBar>
    </Header>
  );
}
