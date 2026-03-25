import { create } from 'zustand';
import { notificationsApi, type AppNotification } from '../api/notifications';

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  panelOpen: boolean;

  fetchNotifications: () => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  dismissAll: () => Promise<void>;
  addRealtime: (notification: AppNotification) => void;
  togglePanel: () => void;
  closePanel: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  panelOpen: false,

  fetchNotifications: async () => {
    set({ loading: true });
    try {
      const { data } = await notificationsApi.list({ limit: 30 });
      set({ notifications: data.data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchUnreadCount: async () => {
    try {
      const { data } = await notificationsApi.getUnreadCount();
      set({ unreadCount: data.count });
    } catch {
      /* ignore */
    }
  },

  markRead: async (id) => {
    await notificationsApi.markRead(id);
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, isRead: true } : n
      ),
      unreadCount: Math.max(0, s.unreadCount - 1),
    }));
  },

  markAllRead: async () => {
    await notificationsApi.markAllRead();
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));
  },

  dismiss: async (id) => {
    await notificationsApi.dismiss(id);
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
      unreadCount: s.notifications.find((n) => n.id === id && !n.isRead)
        ? s.unreadCount - 1
        : s.unreadCount,
    }));
  },

  dismissAll: async () => {
    await notificationsApi.dismissAll();
    set({ notifications: [], unreadCount: 0 });
  },

  addRealtime: (notification) => {
    set((s) => ({
      notifications: [notification, ...s.notifications].slice(0, 30),
      unreadCount: s.unreadCount + 1,
    }));
  },

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  closePanel: () => set({ panelOpen: false }),
}));
