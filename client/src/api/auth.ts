import { api } from './client';
import type { GoogleStatus } from '../types/calendar';

export const authApi = {
  getGoogleUrl: () =>
    api.get<{ data: { url: string } }>('/auth/google/url'),

  getGoogleStatus: () =>
    api.get<{ data: GoogleStatus }>('/auth/google/status'),

  disconnectGoogle: () =>
    api.post<{ data: { success: boolean } }>('/auth/google/disconnect'),
};
