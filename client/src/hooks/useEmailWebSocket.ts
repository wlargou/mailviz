import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { api } from '../api/client';

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

/** The longest the first retry waits; each failure doubles it, up to the cap. */
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
/** A connection that stayed up this long starts the backoff over when it drops. */
const STABLE_AFTER_MS = 10_000;
/** A session check that has not answered by now counts as "server unreachable". */
const SESSION_CHECK_TIMEOUT_MS = 10_000;
/** How servers before 1.29.2 closed an unauthenticated socket, after opening it. */
const CLOSE_UNAUTHORIZED = 4001;

let socket: WebSocket | null = null;
let status: WsStatus = 'disconnected';
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let teardownTimer: ReturnType<typeof setTimeout> | undefined;
let stableTimer: ReturnType<typeof setTimeout> | undefined;
let backoff = BASE_DELAY_MS;
let hasConnected = false;
let wasDisconnected = false;
/** The session check in flight, if any. Nothing reconnects until it answers. */
let sessionCheck: symbol | null = null;
/** The session check said 401: signed out, and the page is on its way to /login. */
let sessionEnded = false;

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

/**
 * The wait before the next attempt: the current window, jittered, and the
 * window doubled for the attempt after.
 *
 * "Equal jitter" — somewhere in the top half of the window. Every tab dropped
 * by one deploy then comes back spread out rather than in step, and no wait is
 * ever close to zero.
 */
function nextDelay(): number {
  const ceiling = backoff;
  backoff = Math.min(backoff * 2, MAX_DELAY_MS);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

function scheduleReconnect() {
  if (subscribers.size === 0) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (subscribers.size > 0) connect();
  }, nextDelay());
}

/**
 * A socket that never opened: the server refused the handshake (no session,
 * or the wrong Origin) or could not be reached. A browser reports all of them
 * as 1006 and says nothing more, so ask the API instead. Its auth middleware
 * also renews an expired access token from the refresh token, so a session
 * that is merely stale comes back from this one request.
 *
 * A 401 ends it: the session is over, the API client's 401 handler is already
 * taking the page to /login, and retrying would only knock on a locked door
 * every 30 seconds. Anything else — the server down, a timeout, a 5xx — is not
 * about the session, and the backoff carries on.
 */
async function checkSessionThenReconnect() {
  const check = Symbol('session check');
  sessionCheck = check;
  let ended = false;
  try {
    await api.get('/auth/me', { timeout: SESSION_CHECK_TIMEOUT_MS });
  } catch (err) {
    ended = isAxiosError(err) && err.response?.status === 401;
  }
  // Released while the check was out: its answer belongs to a connection that
  // no longer exists.
  if (sessionCheck !== check) return;
  sessionCheck = null;

  if (ended) {
    console.log('[WS] Session ended — not reconnecting');
    sessionEnded = true;
    return;
  }
  scheduleReconnect();
}

function connect() {
  if (socket || sessionCheck || sessionEnded || subscribers.size === 0) return;
  setStatus(hasConnected ? 'disconnected' : 'connecting');

  try {
    const ws = new WebSocket(socketUrl());
    socket = ws;
    let opened = false;

    ws.onopen = () => {
      console.log('[WS] Connected');
      opened = true;
      // Reset the backoff once the connection has proved itself, not on open:
      // a server that accepts and drops at once would otherwise be retried
      // every second for as long as the tab stays open.
      clearTimeout(stableTimer);
      stableTimer = setTimeout(() => {
        backoff = BASE_DELAY_MS;
      }, STABLE_AFTER_MS);
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

    ws.onclose = (event) => {
      socket = null;
      clearTimeout(stableTimer);
      wasDisconnected = true;
      setStatus('disconnected');
      if (!opened || event.code === CLOSE_UNAUTHORIZED) {
        console.log('[WS] Connection refused — checking the session');
        void checkSessionThenReconnect();
      } else {
        console.log('[WS] Disconnected, reconnecting...');
        scheduleReconnect();
      }
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
    clearTimeout(stableTimer);
    hasConnected = false;
    wasDisconnected = false;
    backoff = BASE_DELAY_MS;
    sessionCheck = null;
    sessionEnded = false;
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
 * jittered exponential backoff (1 s to 30 s), until the session is found to be
 * over.
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
