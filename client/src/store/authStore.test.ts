import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { authApi } from '../api/auth';
import { useAuthStore } from './authStore';

/**
 * The session store.
 *
 * `ProtectedRoute` renders a spinner while `isLoading`, redirects to /login when
 * `!isAuthenticated`, and calls `fetchUser()` on mount. So every state this store
 * can be left in is a screen the user sees: a stuck `isLoading` is a permanent
 * spinner, a stale `isAuthenticated` after a failed refresh is an app rendering
 * against a dead session, and a `logout` that gives up when the request fails is
 * a user who cannot sign out.
 */

vi.mock('../api/auth', () => ({
  authApi: {
    getMe: vi.fn(),
    logout: vi.fn(),
    updateTimezone: vi.fn().mockResolvedValue({}),
  },
}));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

const alice = {
  id: 'user-alice',
  email: 'alice@example.com',
  name: 'Alice',
  avatarUrl: null,
};

/** Captured before any test mutates it; `setState(_, true)` replaces actions too. */
const initialState = useAuthStore.getState();

const realLocation = window.location;

function stubLocation(pathname = '/mail') {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: `http://localhost:5174${pathname}`, pathname } as unknown as Location,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState(initialState, true);
  stubLocation();
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: realLocation,
  });
});

describe('authStore', () => {
  it('starts unauthenticated but loading', () => {
    const state = useAuthStore.getState();

    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    // isLoading MUST start true. ProtectedRoute redirects whenever it is not
    // loading and not authenticated — starting false bounces every signed-in
    // user to /login on each page load, before /auth/me has had a chance to
    // answer.
    expect(state.isLoading).toBe(true);
  });

  it('stores the user and flips to authenticated on a successful fetch', async () => {
    vi.mocked(authApi.getMe).mockResolvedValue(axiosOk({ data: alice }));

    await useAuthStore.getState().fetchUser();

    expect(useAuthStore.getState()).toMatchObject({
      user: alice,
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it('is loading while the fetch is in flight', async () => {
    let resolve!: (value: AxiosResponse<{ data: typeof alice }>) => void;
    vi.mocked(authApi.getMe).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    // A re-fetch on an already-resolved store must go back to loading, or the
    // guard renders the previous auth state as if it were still confirmed.
    useAuthStore.setState({ isLoading: false });

    const pending = useAuthStore.getState().fetchUser();
    expect(useAuthStore.getState().isLoading).toBe(true);

    resolve(axiosOk({ data: alice }));
    await pending;
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('clears a previously signed-in user when the session check fails', async () => {
    useAuthStore.setState({ user: alice, isAuthenticated: true, isLoading: false });
    vi.mocked(authApi.getMe).mockRejectedValue(new Error('401'));

    await expect(useAuthStore.getState().fetchUser()).resolves.toBeUndefined();

    // Keeping the stale user (or leaving isLoading true) is the difference
    // between "you were signed out" and an app that renders someone else's
    // header against a dead session, or hangs on the spinner forever.
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  it('logs out: clears the session and sends the browser to /login', async () => {
    useAuthStore.setState({ user: alice, isAuthenticated: true, isLoading: false });
    vi.mocked(authApi.logout).mockResolvedValue(axiosOk({ data: { success: true } }));

    await useAuthStore.getState().logout();

    expect(authApi.logout).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false });
    expect(window.location.href).toBe('/login');
  });

  it('logs out locally even when the logout request fails', async () => {
    useAuthStore.setState({ user: alice, isAuthenticated: true, isLoading: false });
    vi.mocked(authApi.logout).mockRejectedValue(new Error('network down'));

    await expect(useAuthStore.getState().logout()).resolves.toBeUndefined();

    // The common cause of a failing /auth/logout is that the session is already
    // gone server-side. If the rejection propagated, or the local state were
    // left intact, "Sign out" would do nothing for exactly the users who need
    // it most.
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false });
    expect(window.location.href).toBe('/login');
  });

  it('clearAuth drops the session without leaving the app loading', () => {
    useAuthStore.setState({ user: alice, isAuthenticated: true, isLoading: true });

    useAuthStore.getState().clearAuth();

    // This is the 401-interceptor path. isLoading must land false, otherwise
    // ProtectedRoute keeps the spinner up instead of redirecting to /login.
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });
});

/**
 * Reporting the browser's timezone.
 *
 * Every day and week boundary the server computes reads the stored zone, and a
 * null means UTC — so a session that never reports one silently keeps the old,
 * wrong behaviour. It is a refinement of an already-successful sign-in though,
 * which is why the interesting cases are all about it NOT mattering: no write
 * when nothing changed, and no effect on auth when it fails.
 */
describe('useAuthStore — timezone reporting', () => {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;

  it('reports the browser zone when the server has none', async () => {
    vi.mocked(authApi.getMe).mockResolvedValue(axiosOk({ data: { ...alice, timezone: null } }));

    await useAuthStore.getState().fetchUser();

    expect(authApi.updateTimezone).toHaveBeenCalledWith(detected);
  });

  it('stays quiet when the server already has this zone', async () => {
    // Otherwise every page load writes the same value back.
    vi.mocked(authApi.getMe).mockResolvedValue(axiosOk({ data: { ...alice, timezone: detected } }));

    await useAuthStore.getState().fetchUser();

    expect(authApi.updateTimezone).not.toHaveBeenCalled();
  });

  it('signs the user in even when reporting the zone rejects', async () => {
    vi.mocked(authApi.getMe).mockResolvedValue(axiosOk({ data: { ...alice, timezone: null } }));
    vi.mocked(authApi.updateTimezone).mockRejectedValue(new Error('offline'));

    await useAuthStore.getState().fetchUser();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('signs the user in even when reporting the zone throws synchronously', async () => {
    // The bug this guards, which the existing tests caught during development:
    // the report sat inside fetchUser's try, so a synchronous throw — a
    // runtime without Intl zone data, a missing method — was indistinguishable
    // from a failed authentication and logged the user out.
    vi.mocked(authApi.getMe).mockResolvedValue(axiosOk({ data: { ...alice, timezone: null } }));
    vi.mocked(authApi.updateTimezone).mockImplementation(() => { throw new Error('boom'); });

    await useAuthStore.getState().fetchUser();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user).toMatchObject({ id: alice.id });
  });
});
