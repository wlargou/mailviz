import { api } from './client';
import type { CalendarEvent, CreateEventInput, UpdateEventInput } from '../types/calendar';

export const calendarApi = {
  getAll: (start: string, end: string) =>
    api.get<{ data: CalendarEvent[] }>('/calendar', { params: { start, end } }),

  getById: (id: string) =>
    api.get<{ data: CalendarEvent }>(`/calendar/${id}`),

  create: (data: CreateEventInput) =>
    api.post<{ data: CalendarEvent }>('/calendar', data),

  update: (id: string, data: UpdateEventInput) =>
    api.patch<{ data: CalendarEvent }>(`/calendar/${id}`, data),

  delete: (id: string, mode: 'single' | 'all' = 'single') =>
    api.delete(`/calendar/${id}`, { params: { mode } }),

  respond: (id: string, response: 'accepted' | 'declined' | 'tentative') =>
    api.post<{ data: CalendarEvent }>(`/calendar/${id}/respond`, { response }),

  sync: () =>
    api.post<{ data: { synced: number; customersCreated: number; contactsCreated: number } }>('/calendar/sync'),

  getSyncStatus: () =>
    api.get<{ data: { syncing: boolean } }>('/calendar/sync-status'),
};
