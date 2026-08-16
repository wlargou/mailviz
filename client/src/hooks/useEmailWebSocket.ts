import { useEffect, useRef, useState } from 'react';

interface WsMessage {
  event: string;
  data: unknown;
  timestamp: number;
}

type EventHandler = (data: any) => void;

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

interface WsOptions {
  /**
   * Called when the socket reopens after having been disconnected — NOT on the
   * first connect. Events broadcast while the socket was down are gone, so the
   * consumer should refetch whatever it renders. The background schedulers keep
   * syncing server-side throughout, so a refetch is enough to catch up; no
   * extra Gmail sync is needed.
   */
  onReconnect?: () => void;
}

interface Subscriber {
  handlers: Record<string, EventHandler>;
  onReconnect?: () => void;
}

/**
 * ─── Shared connection ──────────────────────────────────────────────────────
 *
 * There is exactly ONE socket for the whole app, reference-counted across every
 * `useEmailWebSocket` caller.
 *
 * Previously each mounted hook opened its own WebSocket, so MailPage,
 * CalendarPage, AppSideNav and AppShell held four concurrent connections to the
 * same server. Every broadcast was delivered four times, every drop and
 * backoff cycle ran four times, and there was no single place to ask "are we
 * connected?" — which the status indicator needs.
 */
const subscribers = new Set<Subscriber>();
const statusListeners = new Set<(s: WsStatus) => void>();

let socket: WebSocket | null = null;
let status: WsStatus = 'disconnected';
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let teardownTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelay = 1000;
let hasConnected = false;
let wasDisconnected = false;

function setStatus(next: WsStatus) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((l) => l(next));
}

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In development, the API server is on a different port (3002)
  const host = import.meta.env.DEV ? 'localhost:3002' : window.location.host;
  return `${protocol}//${host}/ws`;
}

function scheduleReconnect() {
  if (subscribers.size === 0) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(delay * 2, 30000); // Exponential backoff, max 30s
  reconnectTimer = setTimeout(() => {
    if (subscribers.size > 0) connect();
  }, delay);
}

function connect() {
  if (socket || subscribers.size === 0) return;
  setStatus(hasConnected ? 'disconnected' : 'connecting');

  try {
    const ws = new WebSocket(socketUrl());
    socket = ws;

    ws.onopen = () => {
      console.log('[WS] Connected');
      reconnectDelay = 1000; // Reset backoff on successful connect
      setStatus('connected');

      // Anything broadcast while we were down was missed, so tell subscribers
      // to refetch. Only after a genuine drop — not the first open.
      if (hasConnected && wasDisconnected) {
        console.log('[WS] Reconnected — refetching to catch up on missed events');
        wasDisconnected = false;
        subscribers.forEach((s) => s.onReconnect?.());
      }
      hasConnected = true;
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        // Fan out to every subscriber that registered this event.
        subscribers.forEach((s) => s.handlers[msg.event]?.(msg.data));
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected, reconnecting...');
      socket = null;
      wasDisconnected = true;
      setStatus('disconnected');
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  } catch {
    socket = null;
    setStatus('disconnected');
    scheduleReconnect();
  }
}

function releaseIfUnused() {
  // Deferred so a React StrictMode double-mount (or a route change that
  // swaps which components subscribe) doesn't tear down and immediately
  // rebuild the connection.
  clearTimeout(teardownTimer);
  teardownTimer = setTimeout(() => {
    if (subscribers.size > 0) return;
    clearTimeout(reconnectTimer);
    hasConnected = false;
    wasDisconnected = false;
    reconnectDelay = 1000;
    if (socket) {
      const s = socket;
      socket = null;
      s.onclose = null; // don't trigger the reconnect path on an intentional close
      s.close();
    }
    setStatus('disconnected');
  }, 1000);
}

/**
 * Subscribe to real-time sync events (email, calendar, etc.) over the app's
 * shared WebSocket. Connects on the first subscriber and reconnects with
 * exponential backoff.
 */
export function useEmailWebSocket(handlers: Record<string, EventHandler>, options: WsOptions = {}) {
  // Hold one stable subscriber object and keep its contents current, so
  // re-renders never churn the connection.
  const subRef = useRef<Subscriber>({ handlers, onReconnect: options.onReconnect });
  subRef.current.handlers = handlers;
  subRef.current.onReconnect = options.onReconnect;

  useEffect(() => {
    const sub = subRef.current;
    subscribers.add(sub);
    clearTimeout(teardownTimer);
    connect();

    return () => {
      subscribers.delete(sub);
      if (subscribers.size === 0) releaseIfUnused();
    };
  }, []);
}

/** Current state of the shared connection, for status indicators. */
export function useWebSocketStatus(): WsStatus {
  const [current, setCurrent] = useState<WsStatus>(status);
  useEffect(() => {
    statusListeners.add(setCurrent);
    setCurrent(status);
    return () => {
      statusListeners.delete(setCurrent);
    };
  }, []);
  return current;
}
