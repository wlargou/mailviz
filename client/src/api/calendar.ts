import { api } from './client';
import type { CalendarEvent, CreateEventInput, UpdateEventInput } from '../types/calendar';

/**
 * Present when the event saved here but could not be sent to Google.
 *
 * The write is real either way — this reports a side effect that failed, not a
 * failed save. Absent for a user who has no Google account connected: that is
 * not a failure and must not warn.
 */
export interface PushWarning {
  code: 'rate_limited' | 'auth' | 'rejected' | 'unavailable';
  retryable: boolean;
  message: string;
}

export const calendarApi = {
  getAll: (start: string, end: string) =>
    api.get<{ data: CalendarEvent[] }>('/calendar', { params: { start, end } }),

  getById: (id: string) =>
    api.get<{ data: CalendarEvent }>(`/calendar/${id}`),

  create: (data: CreateEventInput) =>
    api.post<{ data: CalendarEvent; warning?: PushWarning }>('/calendar', data),

  update: (id: string, data: UpdateEventInput) =>
    api.patch<{ data: CalendarEvent; warning?: PushWarning }>(`/calendar/${id}`, data),

  delete: (id: string, mode: 'single' | 'all' = 'single') =>
    api.delete(`/calendar/${id}`, { params: { mode } }),

  respond: (id: string, response: 'accepted' | 'declined' | 'tentative') =>
    api.post<{ data: CalendarEvent }>(`/calendar/${id}/respond`, { response }),

  sync: () =>
    api.post<{ data: { synced: number; customersCreated: number; contactsCreated: number } }>('/calendar/sync'),

  getSyncStatus: () =>
    api.get<{ data: { syncing: boolean } }>('/calendar/sync-status'),
};
