import { api } from './client';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  isDismissed: boolean;
  createdAt: string;
}

export const notificationsApi = {
  list: (params?: { page?: number; limit?: number; unreadOnly?: boolean }) =>
    api.get<{ data: AppNotification[]; total: number; page: number }>('/notifications', { params }),

  getUnreadCount: () =>
    api.get<{ count: number }>('/notifications/count'),

  markRead: (id: string) =>
    api.patch(`/notifications/${id}/read`),

  markAllRead: () =>
    api.post('/notifications/read-all'),

  dismiss: (id: string) =>
    api.delete(`/notifications/${id}`),

  dismissAll: () =>
    api.post('/notifications/dismiss-all'),
};
