import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { useEmailWebSocket, useWebSocketStatus } from './useEmailWebSocket';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get } }));

/**
 * The shared WebSocket connection.
 *
 * Two behaviours here are easy to regress and expensive when they go wrong:
 *
 *  - Every mounted hook used to open its OWN socket, so four components meant
 *    four connections and every broadcast arrived four times. The connection is
 *    now reference-counted, and "one socket regardless of subscriber count" is
 *    the property worth locking down.
 *
 *  - `onReconnect` must fire only after a genuine drop. Firing it on the first
 *    connect would make every page load do a redundant refetch; not firing it
 *    at all means changes broadcast while the socket was down are lost, which
 *    is the bug it was written to fix.
 *
 * And since 1.29.2, how it retries. The server refuses a handshake without a
 * session as HTTP, which a browser reports only as a close with 1006 on a socket
 * that never opened — so the hook asks the API whether the session still holds
 * before trying again, and stops when it does not. Before that, the backoff was
 * reset on every `open`, and an expired tab reconnected once a second for good.
 */

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  readyState = 0;
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  /** The connection was up and went away. */
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  /**
   * The handshake failed — refused by the server, or nobody answered. A browser
   * cannot tell the two apart: an error, then a close with 1006, and no `open`.
   */
  refuse() {
    this.readyState = 3;
    this.onerror?.();
    this.onclose?.({ code: 1006 });
  }

  emit(event: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ event, data, timestamp: Date.now() }) });
  }

  close() {
    this.readyState = 3;
  }
}

const latest = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

function httpError(status?: number) {
  const response = status
    ? { status, statusText: '', data: {}, headers: {}, config: { headers: new AxiosHeaders() } }
    : undefined;
  return new AxiosError(status ? `Request failed with status code ${status}` : 'Network Error', undefined, undefined, undefined, response);
}

/** Advance the clock, and let a session check that resolves in between finish. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  vi.useFakeTimers();
  // Jitter pinned to the middle of its range: each wait is 3/4 of its window.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  get.mockReset();
  get.mockResolvedValue({ data: { data: { id: 'u1' } } });
});

afterEach(() => {
  // The connection is a module-level singleton and its teardown is deliberately
  // deferred (so a StrictMode double-mount doesn't churn the socket). Each test
  // unmounts its subscribers, but the deferred release only runs on a timer —
  // so flush it here, or the next test inherits a live socket and never opens
  // one of its own. `cleanup` first, for a test that failed before unmounting:
  // its subscribers would otherwise hold the socket into every test after it.
  cleanup();
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useEmailWebSocket', () => {
  it('opens a single socket no matter how many subscribers mount', () => {
    const a = renderHook(() => useEmailWebSocket({}));
    const b = renderHook(() => useEmailWebSocket({}));
    const c = renderHook(() => useEmailWebSocket({}));

    expect(FakeWebSocket.instances).toHaveLength(1);

    a.unmount();
    b.unmount();
    c.unmount();
  });

  it('delivers each message once per subscriber', () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = renderHook(() => useEmailWebSocket({ 'emails:synced': first }));
    const b = renderHook(() => useEmailWebSocket({ 'emails:synced': second }));

    act(() => latest().open());
    act(() => latest().emit('emails:synced', { count: 3 }));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith({ count: 3 });

    a.unmount();
    b.unmount();
  });

  it('ignores events with no registered handler, and malformed frames', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useEmailWebSocket({ 'email:updated': handler }));

    act(() => latest().open());
    act(() => latest().emit('something:else', {}));
    act(() => latest().onmessage?.({ data: 'not json' }));

    expect(handler).not.toHaveBeenCalled();
    unmount();
  });

  it('does NOT call onReconnect on the first connect', () => {
    const onReconnect = vi.fn();
    const { unmount } = renderHook(() => useEmailWebSocket({}, { onReconnect }));

    act(() => latest().open());

    expect(onReconnect).not.toHaveBeenCalled();
    unmount();
  });

  it('calls onReconnect after a genuine drop and reconnect', () => {
    const onReconnect = vi.fn();
    const { unmount } = renderHook(() => useEmailWebSocket({}, { onReconnect }));

    act(() => latest().open());
    act(() => latest().drop());
    // The first wait is at most 1s.
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => latest().open());

    expect(onReconnect).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('notifies every subscriber on reconnect', () => {
    const one = vi.fn();
    const two = vi.fn();
    const a = renderHook(() => useEmailWebSocket({}, { onReconnect: one }));
    const b = renderHook(() => useEmailWebSocket({}, { onReconnect: two }));

    act(() => latest().open());
    act(() => latest().drop());
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => latest().open());

    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);

    a.unmount();
    b.unmount();
  });
});

describe('reconnecting', () => {
  /** Expect no new socket for `ms - 1`, then one at `ms`. */
  async function expectNextAttemptAfter(ms: number) {
    const before = FakeWebSocket.instances.length;
    await advance(ms - 1);
    expect(FakeWebSocket.instances).toHaveLength(before);
    await advance(1);
    expect(FakeWebSocket.instances).toHaveLength(before + 1);
  }

  it('waits somewhere in the top half of the window, never near zero', async () => {
    const { unmount } = renderHook(() => useEmailWebSocket({}));
    act(() => latest().open());

    vi.mocked(Math.random).mockReturnValue(0);
    act(() => latest().drop());
    await expectNextAttemptAfter(500);

    act(() => latest().open());
    vi.mocked(Math.random).mockReturnValue(0.99);
    act(() => latest().drop());
    // The second window is 2s: its top half runs from 1s to 2s.
    await expectNextAttemptAfter(1990);

    unmount();
  });

  it('doubles the wait after each refused attempt, up to 30 s', async () => {
    const { unmount } = renderHook(() => useEmailWebSocket({}));

    // Windows of 1, 2, 4, 8, 16 and then 30 seconds, waited at 3/4 each.
    for (const wait of [750, 1500, 3000, 6000, 12000, 22500, 22500]) {
      act(() => latest().refuse());
      await expectNextAttemptAfter(wait);
    }

    // Every refusal asked the API once, and only once, whether the session holds.
    expect(get).toHaveBeenCalledTimes(7);
    expect(get).toHaveBeenCalledWith('/auth/me', expect.objectContaining({ timeout: expect.any(Number) }));
    unmount();
  });

  it('stops for good once the session check answers 401', async () => {
    get.mockRejectedValue(httpError(401));
    const { unmount } = renderHook(() => useEmailWebSocket({}));
    const status = renderHook(() => useWebSocketStatus());

    act(() => latest().refuse());
    await advance(10 * 60_000);

    // One socket, one check, and silence after it — the API client's own 401
    // handler is what takes the page to /login.
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(status.result.current).toBe('disconnected');

    // A component mounting afterwards does not start it again.
    const late = renderHook(() => useEmailWebSocket({}));
    await advance(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);

    late.unmount();
    status.unmount();
    unmount();
  });

  it.each([
    ['the server cannot be reached', httpError()],
    ['the server answers 503', httpError(503)],
  ])('keeps backing off when %s', async (_case, error) => {
    get.mockRejectedValue(error);
    const { unmount } = renderHook(() => useEmailWebSocket({}));

    act(() => latest().refuse());
    await expectNextAttemptAfter(750);
    act(() => latest().refuse());
    await expectNextAttemptAfter(1500);

    unmount();
  });

  it('tries nothing while the session check is out', async () => {
    get.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderHook(() => useEmailWebSocket({}));

    act(() => latest().refuse());
    const late = renderHook(() => useEmailWebSocket({}));
    await advance(5 * 60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    late.unmount();
    unmount();
  });

  it('ignores a check that answers after the socket was let go', async () => {
    // Every subscriber unmounts while the check is out, and the next page opens
    // a fresh connection. The old answer — a 401 here — belongs to the old one
    // and must not end the new.
    let answer: (err: unknown) => void = () => {};
    get.mockReturnValueOnce(new Promise((_resolve, reject) => (answer = reject)));
    const first = renderHook(() => useEmailWebSocket({}));
    act(() => latest().refuse());
    first.unmount();
    await advance(5000);

    const second = renderHook(() => useEmailWebSocket({}));
    expect(FakeWebSocket.instances).toHaveLength(2);
    act(() => latest().open());
    await act(async () => answer(httpError(401)));

    act(() => latest().drop());
    await expectNextAttemptAfter(750);
    second.unmount();
  });

  it('keeps growing the wait when a server accepts and drops at once', async () => {
    // The old failure: the backoff reset on `open`, so a socket the server
    // closed straight after accepting was retried every second, for good.
    const { unmount } = renderHook(() => useEmailWebSocket({}));

    for (const wait of [750, 1500, 3000]) {
      act(() => latest().open());
      act(() => latest().drop());
      await expectNextAttemptAfter(wait);
    }

    // It opened each time, so the session was never in question.
    expect(get).not.toHaveBeenCalled();
    unmount();
  });

  it('starts the backoff over after a connection that stayed up', async () => {
    const { unmount } = renderHook(() => useEmailWebSocket({}));

    act(() => latest().refuse());
    await expectNextAttemptAfter(750);
    act(() => latest().refuse());
    await expectNextAttemptAfter(1500);

    act(() => latest().open());
    await advance(10_000);
    act(() => latest().drop());

    await expectNextAttemptAfter(750);
    unmount();
  });

  it("treats the old server's 4001 close as a refusal", async () => {
    // Before 1.29.2 the server opened the socket and then closed it with 4001
    // for want of a session. A tab still talking to one is checked, not looped.
    get.mockRejectedValue(httpError(401));
    const { unmount } = renderHook(() => useEmailWebSocket({}));

    act(() => latest().open());
    act(() => latest().drop(4001));
    await advance(10 * 60_000);

    expect(get).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    unmount();
  });
});

describe('useWebSocketStatus', () => {
  it('reports connected, then disconnected on a drop', () => {
    const sub = renderHook(() => useEmailWebSocket({}));
    const status = renderHook(() => useWebSocketStatus());

    // Status is pushed to listeners synchronously, so no waitFor is needed —
    // and waitFor would hang here anyway, since it polls on real timers.
    act(() => latest().open());
    expect(status.result.current).toBe('connected');

    act(() => latest().drop());
    expect(status.result.current).toBe('disconnected');

    status.unmount();
    sub.unmount();
  });
});
