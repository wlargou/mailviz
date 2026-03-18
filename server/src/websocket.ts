import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import cookie from 'cookie';
import { verifyAccessToken } from './utils/jwt.js';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

function authenticateWs(req: IncomingMessage): boolean {
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    const accessToken = cookies.access_token;
    if (!accessToken) return false;
    verifyAccessToken(accessToken);
    return true;
  } catch {
    return false;
  }
}

export function initWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Verify JWT from cookies
    if (!authenticateWs(req)) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    clients.add(ws);
    console.log(`[WS] Client connected (${clients.size} total)`);

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected (${clients.size} total)`);
    });

    ws.on('error', () => {
      clients.delete(ws);
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

/** Get the number of connected clients */
export function wsClientCount(): number {
  return clients.size;
}
