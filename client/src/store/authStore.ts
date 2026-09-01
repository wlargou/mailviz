import { create } from 'zustand';
import { authApi } from '../api/auth';

interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  /**
   * IANA zone stored server-side; null means UTC (see server utils/timezone.ts).
   *
   * Optional to match the API type, where `/auth/users` returns the same shape
   * for the sharing picker without other people's timezones on it.
   */
  timezone?: string | null;
}

/**
 * Tell the server which timezone this browser is in, if it does not already
 * know.
 *
 * Every day and week boundary — the dashboard's "today", "meeting hours this
 * week", the date on an all-day event pushed to Google — is computed from the
 * stored value, and a null means UTC. Detecting it here rather than asking is
 * the difference between the feature working for everyone and working for
 * whoever finds the setting.
 *
 * Deliberately fire-and-forget: the timezone is a refinement, and a failed PUT
 * must never be able to break sign-in. It also only writes on a genuine
 * mismatch, so the ordinary page load costs nothing.
 */
function reportTimezone(stored: string | null): void {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected || detected === stored) return;
    authApi.updateTimezone(detected).catch(() => {
      // Nothing to do and nothing to show: the server keeps using what it has.
    });
  } catch {
    // A `.catch()` only covers a rejected promise. This guards the synchronous
    // throws — a runtime without the Intl zone data, or the call itself blowing
    // up — which would otherwise propagate into fetchUser's catch and log the
    // user out. The first version of this had exactly that bug.
  }
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchUser: () => Promise<void>;
  logout: () => Promise<void>;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  fetchUser: async () => {
    let me: User;
    try {
      set({ isLoading: true });
      const { data } = await authApi.getMe();
      me = data.data;
      set({ user: me, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }

    // Outside the try on purpose. Reporting the timezone is a refinement of a
    // session that has already succeeded, and anything it throws must not be
    // mistaken for a failed authentication.
    reportTimezone(me.timezone ?? null);
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // Continue even if the request fails
    }
    set({ user: null, isAuthenticated: false });
    window.location.href = '/login';
  },

  clearAuth: () => {
    set({ user: null, isAuthenticated: false, isLoading: false });
  },
}));
