import { useEffect, useRef, useCallback } from 'react';

interface WsMessage {
  event: string;
  data: unknown;
  timestamp: number;
}

type EventHandler = (data: any) => void;

/**
 * WebSocket hook for real-time sync updates (email, calendar, etc.).
 * Automatically connects, reconnects with exponential backoff,
 * and invokes handlers when server emits events.
 */
export function useEmailWebSocket(handlers: Record<string, EventHandler>) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const reconnectDelayRef = useRef(1000);
  const mountedRef = useRef(true);

  // Keep handlers ref current without causing reconnects
  handlersRef.current = handlers;

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
