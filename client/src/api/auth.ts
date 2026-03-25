import { api } from './client';
import type { GoogleStatus } from '../types/calendar';

interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export const authApi = {
  // Login flow
  getLoginUrl: () =>
    api.get<{ data: { url: string } }>('/auth/login/google/url'),

  getMe: () =>
    api.get<{ data: User }>('/auth/me'),

  logout: () =>
    api.post<{ data: { success: boolean } }>('/auth/logout'),

  // Google integration (connect/disconnect)
  getGoogleUrl: () =>
    api.get<{ data: { url: string } }>('/auth/google/url'),

  getGoogleStatus: () =>
    api.get<{ data: GoogleStatus }>('/auth/google/status'),

  disconnectGoogle: () =>
    api.post<{ data: { success: boolean } }>('/auth/google/disconnect'),

  // Users list (for sharing)
  getUsers: () =>
    api.get<{ data: User[] }>('/auth/users'),

  // Email signature
  getSignature: () =>
    api.get<{ signature: string | null }>('/auth/signature'),

  updateSignature: (signature: string | null) =>
    api.put('/auth/signature', { signature }),
};
