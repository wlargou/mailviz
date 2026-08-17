import { create } from 'zustand';

export type CarbonTheme = 'g10' | 'g100';

interface Notification {
  id: string;
  kind: 'success' | 'error' | 'info' | 'warning';
  title: string;
  subtitle?: string;
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

export const useUIStore = create<UIState>((set) => ({
  theme: (localStorage.getItem('mailviz-theme') as CarbonTheme) || 'g100',
  // Persisted like the theme. Collapsing the nav is a lasting preference about
  // how much of the window belongs to content, and re-expanding it on every
  // reload made the toggle feel like it had not worked.
  sideNavOpen: localStorage.getItem('mailviz-sidenav') !== 'collapsed',
  notifications: [],

  toggleTheme: () =>
    set((state) => {
      const newTheme = state.theme === 'g10' ? 'g100' : 'g10';
      localStorage.setItem('mailviz-theme', newTheme);
      return { theme: newTheme };
    }),

  setSideNavOpen: (open) => {
    localStorage.setItem('mailviz-sidenav', open ? 'expanded' : 'collapsed');
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
