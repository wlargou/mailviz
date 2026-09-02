import { api } from './client';
import type { GoogleStatus } from '../types/calendar';

interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  /**
   * IANA zone stored server-side; null means UTC.
   *
   * Optional here because `/auth/users` returns the same shape for the sharing
   * picker and has no business exposing other people's timezones.
   */
  timezone?: string | null;
}

export interface AccountDeletionSummary {
  email: string;
  emails: number;
  calendarEvents: number;
  companies: number;
  contacts: number;
  tasks: number;
  deals: number;
  drafts: number;
  scheduledEmails: number;
  templates: number;
  labels: number;
  /** Tasks owned by other people, assigned to this account. Unassigned, not deleted. */
  assignedByOthers: number;
  sharesGiven: number;
  googleConnected: boolean;
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

  // Account deletion
  getAccountDeletionSummary: () =>
    api.get<{ data: AccountDeletionSummary }>('/auth/account/summary'),

  deleteAccount: (confirmEmail: string) =>
    api.delete<{ data: { success: boolean } }>('/auth/account', { data: { confirmEmail } }),

  // Users list (for sharing)
  getUsers: () =>
    api.get<{ data: User[] }>('/auth/users'),

  // Email signature
  getSignature: () =>
    api.get<{ signature: string | null }>('/auth/signature'),

  updateSignature: (signature: string | null) =>
    api.put('/auth/signature', { signature }),

  /** Report the browser's IANA timezone; every day boundary is computed from it. */
  updateTimezone: (timezone: string) =>
    api.put('/auth/timezone', { timezone }),
};

/** What the running server reports about itself. Public — no session needed. */
export interface ServerVersion {
  version: string;
  startedAt: string;
  environment: string;
}

/**
 * Deliberately not on the shared `api` instance: that one prefixes `/api/v1`
 * and redirects to /login on a 401, and this endpoint is public and sits
 * outside the versioned namespace precisely so it can be reached when things
 * are going wrong.
 */
export async function fetchServerVersion(): Promise<ServerVersion> {
  const res = await fetch('/api/version', { credentials: 'omit' });
  if (!res.ok) throw new Error(`version endpoint returned ${res.status}`);
  return (await res.json()).data as ServerVersion;
}
