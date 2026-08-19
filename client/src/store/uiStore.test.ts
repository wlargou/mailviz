import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { useUIStore as UIStoreHook } from './uiStore';

/**
 * The shell store: theme, side-nav, and toast notifications.
 *
 * The first two are read out of localStorage at module scope — i.e. once, on
 * every app boot, before anything renders. That makes the read the risky part:
 * whatever it returns is written straight onto <html data-carbon-theme>, so a
 * value that is neither 'g10' nor 'g100' leaves the app with no Carbon theme at
 * all (unreadable, not merely wrong), and a read that throws — which localStorage
 * does when storage is blocked — takes the whole bundle down with it, because
 * this module is imported by AppShell.
 */

type UIStore = typeof UIStoreHook;

/** Re-import the module so its localStorage reads run again against the current storage. */
async function boot(): Promise<UIStore> {
  vi.resetModules();
  const mod = await import('./uiStore');
  return mod.useUIStore;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('uiStore boot state', () => {
  it('defaults to the dark theme with the nav expanded on a first visit', async () => {
    const useUIStore = await boot();

    expect(useUIStore.getState().theme).toBe('g100');
    expect(useUIStore.getState().sideNavOpen).toBe(true);
    expect(useUIStore.getState().notifications).toEqual([]);
  });

  it('restores a persisted theme', async () => {
    localStorage.setItem('mailviz-theme', 'g10');

    const useUIStore = await boot();

    expect(useUIStore.getState().theme).toBe('g10');
  });

  it('falls back to the default theme when the stored value is not a Carbon theme', async () => {
    localStorage.setItem('mailviz-theme', 'purple');

    const useUIStore = await boot();

    // AppShell writes this value verbatim to <html data-carbon-theme>. Carbon
    // only defines tokens for its own theme names, so anything else means no
    // --cds-* variables resolve and the app boots unstyled.
    expect(useUIStore.getState().theme).toBe('g100');
  });

  it('restores a collapsed side nav', async () => {
    localStorage.setItem('mailviz-sidenav', 'collapsed');

    const useUIStore = await boot();

    expect(useUIStore.getState().sideNavOpen).toBe(false);
  });

  it('treats any non-collapsed side-nav value as expanded', async () => {
    localStorage.setItem('mailviz-sidenav', 'garbage');

    const useUIStore = await boot();

    // Erring towards expanded is the safe fallback: a wrongly-collapsed nav on
    // a corrupt value looks like the app lost its navigation.
    expect(useUIStore.getState().sideNavOpen).toBe(true);
  });

  it('boots with the defaults when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage is disabled');
    });

    // Browsers configured to block site data throw on every localStorage access.
    // This module is imported by AppShell, so a throw here is a blank page
    // rather than a lost preference.
    const useUIStore = await boot();

    expect(useUIStore.getState().theme).toBe('g100');
    expect(useUIStore.getState().sideNavOpen).toBe(true);
  });

  it('still toggles when localStorage cannot be written', async () => {
    const useUIStore = await boot();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => useUIStore.getState().toggleTheme()).not.toThrow();
    expect(useUIStore.getState().theme).toBe('g10');

    expect(() => useUIStore.getState().setSideNavOpen(false)).not.toThrow();
    expect(useUIStore.getState().sideNavOpen).toBe(false);
  });
});

describe('uiStore preferences', () => {
  it('toggles between the two Carbon themes and persists the choice', async () => {
    const useUIStore = await boot();

    useUIStore.getState().toggleTheme();
    expect(useUIStore.getState().theme).toBe('g10');
    expect(localStorage.getItem('mailviz-theme')).toBe('g10');

    useUIStore.getState().toggleTheme();
    expect(useUIStore.getState().theme).toBe('g100');
    expect(localStorage.getItem('mailviz-theme')).toBe('g100');
  });

  it('a toggled theme survives a reload', async () => {
    const first = await boot();
    first.getState().toggleTheme();

    const second = await boot();

    // The write format and the read format have to agree. When they drift the
    // toggle appears to work and then silently resets on the next page load.
    expect(second.getState().theme).toBe('g10');
  });

  it('a collapsed side nav survives a reload', async () => {
    const first = await boot();
    first.getState().setSideNavOpen(false);
    expect(localStorage.getItem('mailviz-sidenav')).toBe('collapsed');

    const second = await boot();
    expect(second.getState().sideNavOpen).toBe(false);

    second.getState().setSideNavOpen(true);
    expect(localStorage.getItem('mailviz-sidenav')).toBe('expanded');
    expect((await boot()).getState().sideNavOpen).toBe(true);
  });
});

describe('uiStore toasts', () => {
  it('queues notifications with distinct ids and keeps the earlier ones', async () => {
    const useUIStore = await boot();

    useUIStore.getState().addNotification({ kind: 'success', title: 'Task created' });
    useUIStore
      .getState()
      .addNotification({ kind: 'error', title: 'Send failed', subtitle: 'Try again' });

    const { notifications } = useUIStore.getState();
    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n.title)).toEqual(['Task created', 'Send failed']);
    expect(notifications[1].subtitle).toBe('Try again');
    // The ids are React keys in NotificationContainer; duplicates would make
    // dismissing one toast close the wrong one.
    expect(notifications[0].id).not.toBe(notifications[1].id);
  });

  it('removes only the notification that was dismissed', async () => {
    const useUIStore = await boot();
    useUIStore.getState().addNotification({ kind: 'info', title: 'First' });
    useUIStore.getState().addNotification({ kind: 'info', title: 'Second' });
    const [first] = useUIStore.getState().notifications;

    useUIStore.getState().removeNotification(first.id);

    // Each toast auto-closes on its own 4s timeout, so overlapping toasts
    // dismiss independently — clearing the queue would erase a message the user
    // never saw.
    expect(useUIStore.getState().notifications.map((n) => n.title)).toEqual(['Second']);
  });

  it('ignores a dismissal for an id that is already gone', async () => {
    const useUIStore = await boot();
    useUIStore.getState().addNotification({ kind: 'info', title: 'Only' });
    const [only] = useUIStore.getState().notifications;

    useUIStore.getState().removeNotification(only.id);
    // ToastNotification can fire onClose twice (timeout and click).
    expect(() => useUIStore.getState().removeNotification(only.id)).not.toThrow();

    expect(useUIStore.getState().notifications).toEqual([]);
  });
});
