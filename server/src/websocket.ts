import { WebSocketServer, WebSocket } from 'ws';
import { STATUS_CODES, type IncomingMessage, type Server } from 'http';
import type { Duplex } from 'stream';
// Named import, not default: cookie 2.x removed the default export and renamed
// `parse` to `parseCookie`.
import { parseCookie } from 'cookie';
import { env } from './config/env.js';
import { verifyAccessToken, verifyRefreshToken } from './utils/jwt.js';
import { appOriginCheck } from './utils/appOrigin.js';

/**
 * How often every socket is pinged: well inside the idle timeout a proxy puts
 * on a quiet stream (Envoy's is 5 minutes), which otherwise cuts every socket
 * that has had nothing to say. The same ping is how a dead peer — a laptop that
 * slept, a network that vanished — is noticed: a socket that has not answered
 * one ping by the next is terminated.
 */
export const HEARTBEAT_INTERVAL_MS = 25_000;

let wss: WebSocketServer | null = null;
let attachedTo: Server | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
/**
 * Whether an Origin may open a socket: the app's own, from CLIENT_URL — plus
 * loopback pages in development. The same rule as the API's writes. Refuses
 * everything until `initWebSocket` sets it.
 */
let isAppOrigin: (origin: string) => boolean = () => false;
const clients = new Set<WebSocket>();
const userClients = new Map<string, Set<WebSocket>>();
/** Sockets that answered the last ping, or have not been pinged yet. */
const alive = new WeakSet<WebSocket>();

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
 * Answer an upgrade with a plain HTTP status and hang up.
 *
 * Half-closed with `end` and destroyed on `finish`, as `ws` does for its own
 * refusals, so the status line reaches the client before the socket goes. The
 * error listener is not optional: Node detaches its own from a socket it hands
 * to `'upgrade'`, so a client resetting mid-refusal would otherwise be an
 * uncaught exception — a crashed server.
 */
function refuse(socket: Duplex, status: 401 | 403 | 404) {
  socket.on('error', () => socket.destroy());
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
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

function register(ws: WebSocket, userId: string) {
  clients.add(ws);
  alive.add(ws);

  // Track per-user connections
  if (!userClients.has(userId)) {
    userClients.set(userId, new Set());
  }
  userClients.get(userId)!.add(ws);

  console.log(`[WS] Client connected for user ${userId} (${clients.size} total)`);

  ws.on('pong', () => alive.add(ws));

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
}

/**
 * Decide an upgrade before answering it: path, then Origin, then session, all
 * before the 101.
 *
 * `ws` used to accept every handshake on /ws and read the cookie afterwards,
 * closing with 4001. The browser saw `open`, the client reset its backoff, and
 * a tab whose session had expired reconnected once a second for as long as it
 * stayed open. Refused here, the handshake fails as HTTP and nothing opens.
 *
 * The Origin check does what SameSite=Lax no longer can. A handshake carries
 * the cookies from any page on the same *site*, and under one registrable
 * domain every sibling subdomain is the same site — so without it, a page on
 * any of them could open /ws as the user and read their events. Browsers always
 * send Origin on a handshake, so a missing one is refused as well.
 */
function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const pathname = (req.url ?? '').split('?')[0];
  if (pathname !== '/ws' || !wss) {
    refuse(socket, 404);
    return;
  }

  const origin = req.headers.origin;
  if (origin === undefined || !isAppOrigin(origin)) {
    // Logged with the value: after a hostname change, a CLIENT_URL that was not
    // updated refuses every socket, and this line is what says so.
    console.warn(`[WS] Refused upgrade from origin ${JSON.stringify(origin ?? null)}`);
    refuse(socket, 403);
    return;
  }

  const userId = authenticateWs(req);
  if (!userId) {
    refuse(socket, 401);
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => register(ws, userId));
}

/**
 * Ping every socket, and terminate any that did not answer the previous ping.
 *
 * Terminate, not close: a peer that stopped answering will not answer a close
 * frame either, and `terminate` is what fires `close` — and so `forget` — now
 * rather than after `ws`'s 30-second closing timeout.
 */
function sweep() {
  for (const ws of clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}

export function initWebSocket(server: Server) {
  isAppOrigin = appOriginCheck(env.CLIENT_URL, env.NODE_ENV);
  wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', onUpgrade);
  attachedTo = server;
  heartbeat = setInterval(sweep, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

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
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  // Detached here rather than left to the process exit: a second
  // `initWebSocket` on the same server (the tests do it) would otherwise leave
  // two handlers answering every upgrade.
  if (attachedTo) {
    attachedTo.off('upgrade', onUpgrade);
    attachedTo = null;
  }
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
