import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import cookie from 'cookie';
import { verifyAccessToken, verifyRefreshToken } from './utils/jwt.js';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();
const userClients = new Map<string, Set<WebSocket>>();

function authenticateWs(req: IncomingMessage): string | null {
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    const accessToken = cookies.access_token;
    if (accessToken) {
      try {
        const payload = verifyAccessToken(accessToken);
        return payload.sub;
      } catch {
        // Access token expired — try refresh token
      }
    }
    // Fall back to refresh token (S6: prevents WS auth failures after 15min)
    const refreshToken = cookies.refresh_token;
    if (refreshToken) {
      const payload = verifyRefreshToken(refreshToken);
      return payload.sub;
    }
    return null;
  } catch {
    return null;
  }
}

export function initWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Verify JWT from cookies
    const userId = authenticateWs(req);
    if (!userId) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    clients.add(ws);

    // Track per-user connections
    if (!userClients.has(userId)) {
      userClients.set(userId, new Set());
    }
    userClients.get(userId)!.add(ws);

    console.log(`[WS] Client connected for user ${userId} (${clients.size} total)`);

    ws.on('close', () => {
      clients.delete(ws);
      const userSet = userClients.get(userId);
      if (userSet) {
        userSet.delete(ws);
        if (userSet.size === 0) userClients.delete(userId);
      }
      console.log(`[WS] Client disconnected (${clients.size} total)`);
    });

    ws.on('error', (err) => {
      console.warn('[WS] Client error:', err.message);
      clients.delete(ws);
      const userSet = userClients.get(userId);
      if (userSet) {
        userSet.delete(ws);
        if (userSet.size === 0) userClients.delete(userId);
      }
    });

    // Send a welcome message so client knows connection is alive
    ws.send(JSON.stringify({ event: 'connected', data: { timestamp: Date.now() } }));
  });

  console.log('[WS] WebSocket server initialized on /ws');
}

/** Broadcast an event to all connected clients */
export function wsEmit(event: string, data: unknown) {
  if (clients.size === 0) return;

  const message = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/** Send an event to all WS connections of a specific user */
export function wsEmitToUser(userId: string, event: string, data: unknown) {
  const userSet = userClients.get(userId);
  if (!userSet || userSet.size === 0) return;

  const message = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const client of userSet) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/** Send an event to multiple users */
export function wsEmitToUsers(userIds: string[], event: string, data: unknown) {
  if (userIds.length === 0) return;

  const message = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const userId of userIds) {
    const userSet = userClients.get(userId);
    if (!userSet) continue;
    for (const client of userSet) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
}

/** Get the number of connected clients */
export function wsClientCount(): number {
  return clients.size;
}

/** Gracefully close all WebSocket connections */
export function shutdownWebSocket() {
  for (const client of clients) {
    client.close(1001, 'Server shutting down');
  }
  clients.clear();
  userClients.clear();
  if (wss) {
    wss.close();
    wss = null;
  }
  console.log('[WS] WebSocket server shut down');
}
