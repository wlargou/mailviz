import { useEffect, useRef, useCallback } from 'react';

interface WsMessage {
  event: string;
  data: unknown;
  timestamp: number;
}

type EventHandler = (data: any) => void;

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

/**
 * WebSocket hook for real-time sync updates (email, calendar, etc.).
 * Automatically connects, reconnects with exponential backoff,
 * and invokes handlers when server emits events.
 */
export function useEmailWebSocket(handlers: Record<string, EventHandler>, options: WsOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  const optionsRef = useRef(options);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectDelayRef = useRef(1000);
  const mountedRef = useRef(true);
  // Distinguishes "opened for the first time" from "came back after a drop".
  const hasConnectedRef = useRef(false);
  const wasDisconnectedRef = useRef(false);

  // Keep refs current without causing reconnects
  handlersRef.current = handlers;
  optionsRef.current = options;

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    // Build WebSocket URL from current page location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // In development, the API server is on a different port (3002)
    const host = import.meta.env.DEV ? 'localhost:3002' : window.location.host;
    const url = `${protocol}//${host}/ws`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected');
        reconnectDelayRef.current = 1000; // Reset backoff on successful connect

        // Anything broadcast while we were down was missed, so tell the
        // consumer to refetch. Only after a genuine drop — not the first open.
        if (hasConnectedRef.current && wasDisconnectedRef.current) {
          console.log('[WS] Reconnected — refetching to catch up on missed events');
          wasDisconnectedRef.current = false;
          optionsRef.current.onReconnect?.();
        }
        hasConnectedRef.current = true;
      };

      ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          const handler = handlersRef.current[msg.event];
          if (handler) {
            handler(msg.data);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting...');
        wasDisconnectedRef.current = true;
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      scheduleReconnect();
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;

    const delay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(delay * 2, 30000); // Exponential backoff, max 30s

    reconnectTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        connect();
      }
    }, delay);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);
}
