import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEmailWebSocket, useWebSocketStatus } from './useEmailWebSocket';

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
 */

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
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

  drop() {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(event: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ event, data, timestamp: Date.now() }) });
  }

  close() {
    this.readyState = 3;
  }
}

const latest = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  // The connection is a module-level singleton and its teardown is deliberately
  // deferred (so a StrictMode double-mount doesn't churn the socket). Each test
  // unmounts its subscribers, but the deferred release only runs on a timer —
  // so flush it here, or the next test inherits a live socket and never opens
  // one of its own.
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
    // Backoff starts at 1s.
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

  it('backs off exponentially rather than reconnecting in a tight loop', () => {
    const { unmount } = renderHook(() => useEmailWebSocket({}));
    act(() => latest().open());

    const before = FakeWebSocket.instances.length;
    act(() => latest().drop());

    // Nothing should happen before the first backoff window elapses.
    act(() => { vi.advanceTimersByTime(500); });
    expect(FakeWebSocket.instances).toHaveLength(before);

    act(() => { vi.advanceTimersByTime(500); });
    expect(FakeWebSocket.instances).toHaveLength(before + 1);

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
