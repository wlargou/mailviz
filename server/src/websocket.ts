import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
// Named import, not default: cookie 2.x removed the default export and renamed
// `parse` to `parseCookie`.
import { parseCookie } from 'cookie';
import { verifyAccessToken, verifyRefreshToken } from './utils/jwt.js';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();
const userClients = new Map<string, Set<WebSocket>>();

function authenticateWs(req: IncomingMessage): string | null {
  try {
    const cookies = parseCookie(req.headers.cookie || '');
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

/**
 * Drop a socket from both registries.
 *
 * Shared by the close and error handlers because it used to be written out
 * twice, identically. Pruning the empty Set out of `userClients` is the part
 * that is easy to omit and impossible to notice: a stale entry changes no
 * behaviour — the dead socket fails the `readyState === OPEN` guard, so nothing
 * is ever delivered to it — while the map grows for the life of the process,
 * holding a dead WebSocket for every user who has ever connected.
 */
function forget(ws: WebSocket, userId: string) {
  clients.delete(ws);
  const userSet = userClients.get(userId);
  if (userSet) {
    userSet.delete(ws);
    if (userSet.size === 0) userClients.delete(userId);
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
      forget(ws, userId);
      console.log(`[WS] Client disconnected (${clients.size} total)`);
    });

    ws.on('error', (err) => {
      console.warn('[WS] Client error:', err.message);
      forget(ws, userId);
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

/**
 * How many distinct accounts currently have a socket open.
 *
 * The counterpart to `wsClientCount`, and the only way to observe that
 * `userClients` is actually pruned on disconnect. Without it a leak there is
 * invisible: a closed socket left in the map still fails the
 * `readyState === OPEN` guard, so nothing is delivered to it and no behaviour
 * changes — the map just grows for the life of the process, holding a dead
 * WebSocket per user who ever connected.
 */
export function wsUserCount(): number {
  return userClients.size;
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
