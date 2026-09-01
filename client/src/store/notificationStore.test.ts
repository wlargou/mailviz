import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { notificationsApi, type AppNotification } from '../api/notifications';
import { useNotificationStore } from './notificationStore';

/**
 * The notification bell store.
 *
 * `unreadCount` is a number the user reads off the header badge, and it is kept
 * in step with the list by hand rather than refetched — every action adjusts it
 * arithmetically. That makes drift the whole risk: a decrement that fires for an
 * already-read notification undercounts, a decrement with no floor can go
 * negative (the badge hides at <= 0), and a duplicate push from the websocket
 * after a reconnect double-counts. All three show a number that does not match
 * the list right below it.
 */

vi.mock('../api/notifications', () => ({
  notificationsApi: {
    list: vi.fn(),
    getUnreadCount: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
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

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'notif-1',
    type: 'TASK_DUE_SOON',
    title: 'Task due soon',
    message: null,
    entityType: 'task',
    entityId: 'task-1',
    isRead: false,
    isDismissed: false,
    createdAt: '2026-08-18T09:00:00.000Z',
    ...overrides,
  };
}

/** Captured before any test mutates it; `setState(_, true)` replaces actions too. */
const initialState = useNotificationStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useNotificationStore.setState(initialState, true);
  vi.mocked(notificationsApi.markRead).mockResolvedValue(axiosOk({}));
  vi.mocked(notificationsApi.markAllRead).mockResolvedValue(axiosOk({}));
  vi.mocked(notificationsApi.dismiss).mockResolvedValue(axiosOk({}));
  vi.mocked(notificationsApi.dismissAll).mockResolvedValue(axiosOk({}));
});

describe('notificationStore', () => {
  it('starts empty with the panel closed', () => {
    expect(useNotificationStore.getState()).toMatchObject({
      notifications: [],
      unreadCount: 0,
      loading: false,
      panelOpen: false,
    });
  });

  it('loads the most recent notifications', async () => {
    const items = [makeNotification({ id: 'a' }), makeNotification({ id: 'b' })];
    vi.mocked(notificationsApi.list).mockResolvedValue(
      axiosOk({ data: items, total: 2, page: 1 })
    );

    await useNotificationStore.getState().fetchNotifications();

    expect(notificationsApi.list).toHaveBeenCalledWith({ limit: 30 });
    expect(useNotificationStore.getState().notifications).toEqual(items);
    expect(useNotificationStore.getState().loading).toBe(false);
  });

  it('keeps the list and stops loading when the fetch fails', async () => {
    const items = [makeNotification({ id: 'a' })];
    vi.mocked(notificationsApi.list).mockResolvedValue(
      axiosOk({ data: items, total: 1, page: 1 })
    );
    await useNotificationStore.getState().fetchNotifications();

    vi.mocked(notificationsApi.list).mockRejectedValue(new Error('500'));
    await expect(useNotificationStore.getState().fetchNotifications()).resolves.toBeUndefined();

    // The panel polls in the background. A blip must not empty it, and must not
    // leave the spinner up in its place.
    expect(useNotificationStore.getState().notifications).toEqual(items);
    expect(useNotificationStore.getState().loading).toBe(false);
  });

  it('keeps the last known badge count when the count request fails', async () => {
    vi.mocked(notificationsApi.getUnreadCount).mockResolvedValue(axiosOk({ count: 4 }));
    await useNotificationStore.getState().fetchUnreadCount();
    expect(useNotificationStore.getState().unreadCount).toBe(4);

    vi.mocked(notificationsApi.getUnreadCount).mockRejectedValue(new Error('network'));
    await expect(useNotificationStore.getState().fetchUnreadCount()).resolves.toBeUndefined();

    // This runs on a 60s interval; a single failed poll must not blank the
    // badge and make unread work look handled.
    expect(useNotificationStore.getState().unreadCount).toBe(4);
  });

  it('marks one notification read and drops the badge by one', async () => {
    useNotificationStore.setState({
      notifications: [makeNotification({ id: 'a' }), makeNotification({ id: 'b' })],
      unreadCount: 2,
    });

    await useNotificationStore.getState().markRead('a');

    expect(notificationsApi.markRead).toHaveBeenCalledWith('a');
    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications.find((n) => n.id === 'a')?.isRead).toBe(true);
    expect(notifications.find((n) => n.id === 'b')?.isRead).toBe(false);
    expect(unreadCount).toBe(1);
  });

  it('does not drop the badge when the notification was already read', async () => {
    useNotificationStore.setState({
      notifications: [
        makeNotification({ id: 'a', isRead: true }),
        makeNotification({ id: 'b' }),
      ],
      unreadCount: 1,
    });

    await useNotificationStore.getState().markRead('a');

    // NotificationBell calls markRead() on every click, read or not. Decrementing
    // unconditionally means clicking an already-read row hides a genuinely unread
    // one from the badge — the count drifts below the list on ordinary use.
    expect(useNotificationStore.getState().unreadCount).toBe(1);
    expect(useNotificationStore.getState().notifications.find((n) => n.id === 'b')?.isRead).toBe(
      false
    );
  });

  it('leaves the badge untouched when marking read fails', async () => {
    useNotificationStore.setState({
      notifications: [makeNotification({ id: 'a' })],
      unreadCount: 1,
    });
    vi.mocked(notificationsApi.markRead).mockRejectedValue(new Error('500'));

    await expect(useNotificationStore.getState().markRead('a')).rejects.toThrow('500');

    // Half-updating — badge down, server still unread — resurrects the count on
    // the next poll and makes the bell flicker.
    expect(useNotificationStore.getState()).toMatchObject({ unreadCount: 1 });
    expect(useNotificationStore.getState().notifications[0].isRead).toBe(false);
  });

  it('marks everything read and clears the badge', async () => {
    useNotificationStore.setState({
      notifications: [makeNotification({ id: 'a' }), makeNotification({ id: 'b' })],
      unreadCount: 2,
    });

    await useNotificationStore.getState().markAllRead();

    // The rows must survive. `every()` is vacuously true on an empty array, so
    // on its own it cannot tell "all marked read" from "panel emptied" — a
    // markAllRead that set `notifications: []` passed this test.
    expect(useNotificationStore.getState().notifications.map((n) => n.id)).toEqual(['a', 'b']);
    expect(useNotificationStore.getState().notifications.every((n) => n.isRead)).toBe(true);
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it('dismiss removes the row and only decrements for unread ones', async () => {
    useNotificationStore.setState({
      notifications: [
        makeNotification({ id: 'a' }),
        makeNotification({ id: 'b', isRead: true }),
      ],
      unreadCount: 1,
    });

    await useNotificationStore.getState().dismiss('b');
    // 'b' was already read, so the badge must not move.
    expect(useNotificationStore.getState().unreadCount).toBe(1);
    expect(useNotificationStore.getState().notifications.map((n) => n.id)).toEqual(['a']);

    await useNotificationStore.getState().dismiss('a');
    expect(useNotificationStore.getState().unreadCount).toBe(0);
    expect(useNotificationStore.getState().notifications).toEqual([]);
  });

  it('never lets the badge go negative', async () => {
    // Reachable state: fetchUnreadCount swallows its errors, so one failed poll
    // leaves the count at 0 while the list still holds unread rows.
    useNotificationStore.setState({
      notifications: [makeNotification({ id: 'a' })],
      unreadCount: 0,
    });

    await useNotificationStore.getState().dismiss('a');

    // A negative count hides the badge (it renders only when > 0), so the next
    // real notification takes the count to 0 and stays invisible.
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it('leaves the list untouched when dismiss fails', async () => {
    const items = [makeNotification({ id: 'a' })];
    useNotificationStore.setState({ notifications: items, unreadCount: 1 });
    vi.mocked(notificationsApi.dismiss).mockRejectedValue(new Error('500'));

    await expect(useNotificationStore.getState().dismiss('a')).rejects.toThrow('500');

    // Removing it locally while the server keeps it means it comes back on the
    // next poll — worse than not removing it at all.
    expect(useNotificationStore.getState().notifications).toEqual(items);
    expect(useNotificationStore.getState().unreadCount).toBe(1);
  });

  it('dismissAll removes read rows and leaves unread ones — REGRESSION', async () => {
    // The server dismisses only READ notifications, deliberately: dismissing an
    // unread one throws away something the user has never seen. The client used
    // to empty the list and zero the badge regardless, so unread rows survived
    // server-side while vanishing from the panel — and the 60-second poll
    // brought the badge back over an empty list, with nothing to click.
    useNotificationStore.setState({
      notifications: [
        makeNotification({ id: 'read-one', isRead: true }),
        makeNotification({ id: 'still-unread', isRead: false }),
      ],
      unreadCount: 1,
    });

    await useNotificationStore.getState().dismissAll();

    const state = useNotificationStore.getState();
    expect(state.notifications.map((n) => n.id)).toEqual(['still-unread']);
    // The badge counts unread, and no unread row was dismissed.
    expect(state.unreadCount).toBe(1);
  });

  it('puts a realtime notification at the top and counts it', () => {
    useNotificationStore.setState({
      notifications: [makeNotification({ id: 'old' })],
      unreadCount: 1,
    });

    useNotificationStore.getState().addRealtime(makeNotification({ id: 'new' }));

    expect(useNotificationStore.getState().notifications.map((n) => n.id)).toEqual(['new', 'old']);
    expect(useNotificationStore.getState().unreadCount).toBe(2);
  });

  it('ignores a realtime notification it already has', () => {
    useNotificationStore.setState({
      notifications: [makeNotification({ id: 'dup' })],
      unreadCount: 1,
    });

    useNotificationStore.getState().addRealtime(makeNotification({ id: 'dup' }));

    // The socket replays on reconnect, and a push can race the poll that already
    // fetched the same row. Without the dedupe the panel shows it twice and the
    // badge counts it twice.
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().unreadCount).toBe(1);
  });

  it('caps the in-memory list at the page size it fetches', () => {
    const many = Array.from({ length: 30 }, (_, i) => makeNotification({ id: `n${i}` }));
    useNotificationStore.setState({ notifications: many, unreadCount: 30 });

    useNotificationStore.getState().addRealtime(makeNotification({ id: 'fresh' }));

    // fetchNotifications asks for 30. Letting the list grow without bound on a
    // long-lived tab means the panel keeps every notification of the session.
    expect(useNotificationStore.getState().notifications).toHaveLength(30);
    expect(useNotificationStore.getState().notifications[0].id).toBe('fresh');
    expect(useNotificationStore.getState().notifications.at(-1)?.id).toBe('n28');
  });

  it('toggles and closes the panel', () => {
    useNotificationStore.getState().togglePanel();
    expect(useNotificationStore.getState().panelOpen).toBe(true);

    useNotificationStore.getState().togglePanel();
    expect(useNotificationStore.getState().panelOpen).toBe(false);

    useNotificationStore.setState({ panelOpen: true });
    // closePanel must close rather than toggle: it is wired to both the
    // outside-click handler and the row click, so opening a notification fires
    // it twice and a toggle would leave the panel open on top of the page it
    // just navigated to.
    useNotificationStore.getState().closePanel();
    useNotificationStore.getState().closePanel();
    expect(useNotificationStore.getState().panelOpen).toBe(false);
  });
});
