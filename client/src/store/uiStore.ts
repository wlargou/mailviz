import { create } from 'zustand';

export type CarbonTheme = 'g10' | 'g100';

interface Notification {
  id: string;
  kind: 'success' | 'error' | 'info' | 'warning';
  title: string;
  subtitle?: string;
  /** An offer the toast can carry: "Archive the thread". */
  action?: { label: string; onClick: () => void };
}

interface UIState {
  theme: CarbonTheme;
  sideNavOpen: boolean;
  notifications: Notification[];
  toggleTheme: () => void;
  setSideNavOpen: (open: boolean) => void;
  addNotification: (notification: Omit<Notification, 'id'>) => void;
  removeNotification: (id: string) => void;
}

// Both preferences are read at module scope — once, on every app boot, before
// anything renders — and this module is imported by AppShell. So a throw here is
// a blank page, not a lost preference, and browsers configured to block site data
// throw on any localStorage access at all. Reads and writes are guarded for that
// reason; a preference that cannot be persisted is a far smaller problem than an
// app that will not start.
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked or full — the in-memory preference still applies */
  }
}

const DEFAULT_THEME: CarbonTheme = 'g100';

// AppShell writes this straight to <html data-carbon-theme>, and Carbon only
// defines tokens for its own theme names — anything else leaves every --cds-*
// variable unresolved, so a stale or hand-edited value must not survive the read.
function readTheme(): CarbonTheme {
  const stored = readStored('mailviz-theme');
  return stored === 'g10' || stored === 'g100' ? stored : DEFAULT_THEME;
}

export const useUIStore = create<UIState>((set) => ({
  theme: readTheme(),
  // Persisted like the theme. Collapsing the nav is a lasting preference about
  // how much of the window belongs to content, and re-expanding it on every
  // reload made the toggle feel like it had not worked.
  sideNavOpen: readStored('mailviz-sidenav') !== 'collapsed',
  notifications: [],

  toggleTheme: () =>
    set((state) => {
      const newTheme = state.theme === 'g10' ? 'g100' : 'g10';
      writeStored('mailviz-theme', newTheme);
      return { theme: newTheme };
    }),

  setSideNavOpen: (open) => {
    writeStored('mailviz-sidenav', open ? 'expanded' : 'collapsed');
    set({ sideNavOpen: open });
  },

  addNotification: (notification) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        { ...notification, id: crypto.randomUUID() },
      ],
    })),

  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
}));
