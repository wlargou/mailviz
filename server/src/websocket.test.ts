import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import {
  initWebSocket,
  shutdownWebSocket,
  wsEmit,
  wsEmitToUser,
  wsEmitToUsers,
  wsClientCount,
  wsUserCount,
} from './websocket.js';
import { signAccessToken, signRefreshToken } from './utils/jwt.js';
import jwt from 'jsonwebtoken';
import { env } from './config/env.js';

/**
 * The WebSocket server, at the seam where a browser cookie becomes a user id.
 *
 * This file had 15.6% coverage while being the thing that authenticates every
 * realtime connection and decides which account each event reaches. Two failure
 * modes matter and neither is visible in normal use, because a WebSocket that
 * misbehaves does not throw — it just delivers to the wrong person or lets the
 * wrong person in:
 *
 *  1. **Authentication.** `authenticateWs` re-implements the cookie-to-user
 *     step that `requireAuth` does for HTTP, separately and with different
 *     rules. Any divergence between them is a hole that only exists on this
 *     transport.
 *  2. **Routing.** `wsEmitToUser` is the only thing standing between one
 *     account's mail-sync events and another account's browser. There is no
 *     database query to get wrong here — just a Map — which is exactly why
 *     nothing else would catch a mistake in it.
 *
 * The tests drive real sockets against a real server rather than mocking `ws`,
 * because the parts worth testing (the handshake, cookie parsing, close codes,
 * connection bookkeeping) are precisely the parts a mock would replace.
 *
 * Since 1.29.2 a refusal is an HTTP status on the handshake — 401 without a
 * session, 403 from another origin — decided before the 101. It used to be a
 * 101 followed by a close with 4001, which a browser sees as a socket that
 * opened.
 */

let server: Server;
let wsUrl: string;

/** What a browser on the app's own page sends, read from CLIENT_URL as the server reads it. */
const APP_ORIGIN = new URL(env.CLIENT_URL).origin;

beforeAll(async () => {
  server = createServer();
  initWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

afterAll(async () => {
  shutdownWebSocket();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Sockets opened by the current test, closed in afterEach so counts do not leak. */
let open: WebSocket[] = [];

afterEach(async () => {
  for (const ws of open) {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
  open = [];
  // The server's 'close' handler is what updates the bookkeeping, and it runs a
  // tick after the client closes.
  await waitFor(() => wsClientCount() === 0);
});

interface ConnectOptions {
  /** The Origin header: the app's own unless a test says otherwise, `null` for none at all. */
  origin?: string | null;
  /** `false` makes a client that never answers the server's pings. */
  autoPong?: boolean;
  path?: string;
}

function connect(cookie?: string, { origin = APP_ORIGIN, autoPong, path = '/ws' }: ConnectOptions = {}): WebSocket {
  const ws = new WebSocket(wsUrl.replace(/\/ws$/, path), {
    ...(cookie ? { headers: { cookie } } : {}),
    ...(origin !== null ? { origin } : {}),
    ...(autoPong !== undefined ? { autoPong } : {}),
  });
  open.push(ws);
  return ws;
}

/**
 * Resolves with the HTTP status a handshake was refused with; rejects if the
 * socket opens instead.
 *
 * Opening is the failure that matters. A refused connection used to open — the
 * server completed the upgrade and closed with 4001 afterwards — and that
 * `open` is what reset the browser's backoff and kept an expired tab
 * reconnecting every second.
 */
function refusedWith(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    ws.on('open', () => reject(new Error('socket opened instead of being refused')));
    // Listening for it is what stops `ws` raising it as an error; ending the
    // request is then ours to do.
    ws.on('unexpected-response', (req, res) => {
      res.resume();
      req.destroy();
      resolve(res.statusCode ?? 0);
    });
    ws.on('error', () => {});
    // A no-op once settled; otherwise a socket dropped without any answer.
    ws.on('close', (code) => reject(new Error(`socket closed with ${code} and no HTTP answer`)));
  });
}

/** Resolves with the first message the server sends. */
function firstMessage(ws: WebSocket): Promise<{ event: string; data: unknown }> {
  return new Promise((resolve, reject) => {
    ws.on('message', (raw) => resolve(JSON.parse(raw.toString())));
    ws.on('close', (code) => reject(new Error(`socket closed with ${code} before any message`)));
  });
}

/** Every message received, in order — for asserting a socket got nothing. */
function collect(ws: WebSocket): Array<{ event: string; data: unknown }> {
  const seen: Array<{ event: string; data: unknown }> = [];
  ws.on('message', (raw) => seen.push(JSON.parse(raw.toString())));
  return seen;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Connect and wait until the server has finished registering the socket. */
async function connectAs(userId: string, options: ConnectOptions = {}): Promise<WebSocket> {
  const before = wsClientCount();
  const ws = connect(`access_token=${signAccessToken(userId)}`, options);
  await firstMessage(ws);
  await waitFor(() => wsClientCount() > before);
  return ws;
}

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

describe('WebSocket authentication', () => {
  it('refuses a connection with no cookies at all, before the upgrade', async () => {
    expect(await refusedWith(connect())).toBe(401);
    expect(wsClientCount()).toBe(0);
  });

  it('refuses a cookie header carrying no auth tokens', async () => {
    expect(await refusedWith(connect('theme=g100; other=1'))).toBe(401);
  });

  it('refuses a malformed token', async () => {
    expect(await refusedWith(connect('access_token=not-a-jwt'))).toBe(401);
  });

  it('refuses a token signed with the wrong secret', async () => {
    // A forged token is the case the signature check exists for.
    const forged = jwt.sign({ sub: ALICE, type: 'access' }, 'not-the-real-secret', {
      expiresIn: '15m',
    });
    expect(await refusedWith(connect(`access_token=${forged}`))).toBe(401);
  });

  it('accepts a valid access token and greets the client', async () => {
    const ws = connect(`access_token=${signAccessToken(ALICE)}`);

    const message = await firstMessage(ws);

    // The welcome is how the client knows the socket is live rather than merely
    // open — without it a refused connection and a silent one look identical.
    expect(message.event).toBe('connected');
    expect(message.data).toMatchObject({ timestamp: expect.any(Number) });
  });

  it('falls back to the refresh token when the access token has expired', async () => {
    // Access tokens last 15 minutes and the socket is long-lived, so without
    // this fallback every reconnect after the first quarter-hour is refused.
    const expired = jwt.sign({ sub: ALICE, type: 'access' }, env.JWT_SECRET, { expiresIn: '-1s' });
    const ws = connect(`access_token=${expired}; refresh_token=${signRefreshToken(ALICE)}`);

    expect((await firstMessage(ws)).event).toBe('connected');
  });

  it('accepts a refresh token on its own', async () => {
    const ws = connect(`refresh_token=${signRefreshToken(ALICE)}`);

    expect((await firstMessage(ws)).event).toBe('connected');
  });

  it('refuses a refresh-type token in the access slot — TYPE CONFUSION', async () => {
    // Signed with the ACCESS secret but carrying `type: 'refresh'`. That is the
    // only shape that isolates the claim check: handing over a real refresh
    // token instead would be refused because the two secrets differ, so the
    // `type` check would never run and the test would pass without it.
    //
    // This is the state an operator reaches by setting JWT_SECRET and
    // JWT_REFRESH_SECRET to the same value — at which point a 7-day refresh
    // token becomes a valid socket credential unless the claim is enforced.
    const wrongType = jwt.sign({ sub: ALICE, type: 'refresh' }, env.JWT_SECRET, {
      expiresIn: '15m',
    });
    expect(await refusedWith(connect(`access_token=${wrongType}`))).toBe(401);
  });

  it('refuses an access-type token in the refresh slot', async () => {
    // The mirror case, for the same reason.
    const wrongType = jwt.sign({ sub: ALICE, type: 'access' }, env.JWT_REFRESH_SECRET, {
      expiresIn: '7d',
    });
    expect(await refusedWith(connect(`refresh_token=${wrongType}`))).toBe(401);
  });

  it('refuses an expired refresh token', async () => {
    const expired = jwt.sign({ sub: ALICE, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
      expiresIn: '-1s',
    });
    expect(await refusedWith(connect(`refresh_token=${expired}`))).toBe(401);
  });
});

describe('WebSocket Origin check', () => {
  /**
   * The cookies are SameSite=Lax, and a handshake is a same-site request from
   * any page under the same registrable domain — so once the app shares one
   * with other apps, any of their pages could open this socket as the user and
   * read their events. The Origin header is the only thing that tells them
   * apart, and every case below carries a VALID session: the session is not
   * what is being refused.
   */
  const valid = () => `access_token=${signAccessToken(ALICE)}`;

  it('refuses a valid session opened from another origin', async () => {
    expect(await refusedWith(connect(valid(), { origin: 'https://studio.example.test' }))).toBe(403);
    expect(wsClientCount()).toBe(0);
  });

  it('refuses a handshake with no Origin at all', async () => {
    // Every browser sends one on a WebSocket handshake; only a script does not.
    expect(await refusedWith(connect(valid(), { origin: null }))).toBe(403);
  });

  it('compares the whole origin, not a prefix of it', async () => {
    // `startsWith` would let any host that begins with the app's own through.
    expect(await refusedWith(connect(valid(), { origin: `${APP_ORIGIN}.evil.test` }))).toBe(403);
  });

  it('checks the Origin before the session', async () => {
    // A foreign page is refused for being foreign, whatever it carries: its
    // cookies are never read, and the log line names the origin.
    expect(await refusedWith(connect(undefined, { origin: 'https://studio.example.test' }))).toBe(403);
  });

  it("accepts the app's own origin and delivers only that account's events", async () => {
    const alice = await connectAs(ALICE);
    const bob = await connectAs(BOB);
    const aliceSaw = collect(alice);
    const bobSaw = collect(bob);

    wsEmitToUser(BOB, 'emails:synced', { synced: 1 });
    await waitFor(() => bobSaw.length > 0);

    expect(bobSaw.map((m) => m.event)).toEqual(['emails:synced']);
    expect(aliceSaw).toEqual([]);
  });
});

describe('WebSocket path', () => {
  it('answers upgrades on /ws only', async () => {
    // The server no longer leaves the path to `ws`; anything else is refused
    // rather than upgraded, whatever the session.
    const ws = connect(`access_token=${signAccessToken(ALICE)}`, { path: '/elsewhere' });
    expect(await refusedWith(ws)).toBe(404);
    expect(wsClientCount()).toBe(0);
  });
});

describe('WebSocket per-user routing', () => {
  it('delivers an event only to the account it belongs to', async () => {
    const alice = await connectAs(ALICE);
    const bob = await connectAs(BOB);
    const aliceSaw = collect(alice);
    const bobSaw = collect(bob);

    wsEmitToUser(ALICE, 'emails:synced', { synced: 3 });
    await waitFor(() => aliceSaw.length > 0);

    expect(aliceSaw.map((m) => m.event)).toEqual(['emails:synced']);
    expect(aliceSaw[0].data).toMatchObject({ synced: 3 });
    // The whole point. Bob's browser must not learn that Alice synced, let
    // alone how much mail she has.
    expect(bobSaw).toEqual([]);
  });

  it('reaches every socket the same account has open', async () => {
    // One user with the app in two tabs is the normal case, and a Map holding a
    // single socket per user instead of a Set would drop one of them.
    const first = await connectAs(ALICE);
    const second = await connectAs(ALICE);
    const firstSaw = collect(first);
    const secondSaw = collect(second);

    wsEmitToUser(ALICE, 'email:updated', { id: 'e1' });
    await waitFor(() => firstSaw.length > 0 && secondSaw.length > 0);

    expect(firstSaw).toHaveLength(1);
    expect(secondSaw).toHaveLength(1);
  });

  it('is a no-op for an account with nothing connected', () => {
    expect(() => wsEmitToUser('33333333-3333-4333-8333-333333333333', 'x', {})).not.toThrow();
  });

  it('sends to each named account and nobody else', async () => {
    const alice = await connectAs(ALICE);
    const bob = await connectAs(BOB);
    const aliceSaw = collect(alice);
    const bobSaw = collect(bob);

    wsEmitToUsers([ALICE, BOB], 'task:shared', { taskId: 't1' });
    await waitFor(() => aliceSaw.length > 0 && bobSaw.length > 0);

    expect(aliceSaw[0].event).toBe('task:shared');
    expect(bobSaw[0].event).toBe('task:shared');
  });

  it('skips ids in the list that have no connection', async () => {
    const alice = await connectAs(ALICE);
    const aliceSaw = collect(alice);

    // A share with someone who is offline must still reach whoever is online.
    wsEmitToUsers([ALICE, '44444444-4444-4444-8444-444444444444'], 'deal:shared', {});
    await waitFor(() => aliceSaw.length > 0);

    expect(aliceSaw).toHaveLength(1);
  });

  it('stamps every message with an event, data and timestamp', async () => {
    const alice = await connectAs(ALICE);
    const saw = collect(alice);

    wsEmitToUser(ALICE, 'sync:status', { syncing: true });
    await waitFor(() => saw.length > 0);

    expect(saw[0]).toMatchObject({
      event: 'sync:status',
      data: { syncing: true },
      timestamp: expect.any(Number),
    });
  });
});

describe('wsEmit — the broadcast nobody calls', () => {
  it('reaches every connected client regardless of account', async () => {
    // Documented, not endorsed: `wsEmit` has no call sites in the codebase, and
    // in a multi-tenant app a function that sends the same payload to every
    // logged-in browser is one careless import away from a data leak. This test
    // exists so that the behaviour is written down where someone reaching for
    // it will see what it does.
    const alice = await connectAs(ALICE);
    const bob = await connectAs(BOB);
    const aliceSaw = collect(alice);
    const bobSaw = collect(bob);

    wsEmit('server:announcement', { message: 'hello' });
    await waitFor(() => aliceSaw.length > 0 && bobSaw.length > 0);

    expect(aliceSaw[0].event).toBe('server:announcement');
    expect(bobSaw[0].event).toBe('server:announcement');
  });
});

describe('shutdownWebSocket', () => {
  it('closes every connection and forgets them all', async () => {
    // Deliberately reuses the shared server rather than standing up a second
    // one. `initWebSocket` keeps the WebSocketServer in a module-level
    // singleton, so attaching a second one while the first is still live leaves
    // BOTH handling the same HTTP upgrade — which surfaces as
    // "handleUpgrade() was called more than once with the same socket", passes
    // every assertion, and fails the run only via a non-zero exit code.
    const a = await connectAs(ALICE);
    const b = await connectAs(BOB);
    const closedA = new Promise<number>((resolve) => a.on('close', resolve));
    const closedB = new Promise<number>((resolve) => b.on('close', resolve));

    shutdownWebSocket();

    // 1001 is "going away" — what a client reads to decide whether to
    // reconnect. Closing with the wrong code, or not at all, leaves every
    // browser retrying against a server that is deliberately gone.
    expect(await closedA).toBe(1001);
    expect(await closedB).toBe(1001);
    expect(wsClientCount()).toBe(0);
    expect(wsUserCount()).toBe(0);

    // Put it back for the rest of the file. Safe only because the shutdown
    // above detached the previous upgrade listener.
    initWebSocket(server);
  });

  it('detaches from the HTTP server, so a second init does not answer twice', async () => {
    // Shut down and initialise again, as a restart in place would. With the
    // old listener left behind, both would try to complete the same handshake.
    shutdownWebSocket();
    initWebSocket(server);

    expect(server.listenerCount('upgrade')).toBe(1);
    expect((await firstMessage(connect(`access_token=${signAccessToken(ALICE)}`))).event).toBe('connected');
  });
});

describe('WebSocket connection bookkeeping', () => {
  it('counts connections as they arrive', async () => {
    expect(wsClientCount()).toBe(0);
    await connectAs(ALICE);
    expect(wsClientCount()).toBe(1);
    await connectAs(BOB);
    expect(wsClientCount()).toBe(2);
  });

  it('forgets a socket once it closes', async () => {
    const alice = await connectAs(ALICE);
    expect(wsClientCount()).toBe(1);

    alice.close();
    await waitFor(() => wsClientCount() === 0);

    // And the per-user map is pruned too, not just the flat set. This needs its
    // own assertion because a stale entry changes no behaviour — the dead
    // socket fails the readyState guard, so nothing is delivered either way and
    // the only symptom is a map that grows for the life of the process.
    expect(wsUserCount()).toBe(0);

    const survivor = await connectAs(BOB);
    const saw = collect(survivor);
    wsEmitToUser(ALICE, 'emails:synced', {});
    wsEmitToUser(BOB, 'emails:synced', {});
    await waitFor(() => saw.length > 0);
    expect(saw).toHaveLength(1);
  });

  it('keeps the account reachable while any of its sockets remain', async () => {
    const first = await connectAs(ALICE);
    const second = await connectAs(ALICE);

    first.close();
    await waitFor(() => wsClientCount() === 1);
    // One socket closed, the account still connected — the entry must survive.
    expect(wsUserCount()).toBe(1);

    const saw = collect(second);
    wsEmitToUser(ALICE, 'email:updated', { id: 'e1' });
    await waitFor(() => saw.length > 0);

    // Closing one tab must not stop the other from receiving.
    expect(saw).toHaveLength(1);
  });
});

describe('WebSocket heartbeat', () => {
  /**
   * A proxy cuts a stream that has been quiet for its idle timeout (Envoy's is
   * five minutes), and a peer that vanished without a close — a laptop lid, a
   * dropped network — otherwise stays in the registry for good. The server pings
   * every 25 seconds and terminates a socket that did not answer the last one.
   *
   * Only the interval is faked, so the heartbeat runs on the test's clock while
   * the sockets, and `waitFor`, stay on real I/O and real timeouts.
   */
  beforeEach(() => {
    shutdownWebSocket();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    initWebSocket(server);
  });

  afterEach(() => {
    shutdownWebSocket();
    vi.useRealTimers();
    initWebSocket(server);
  });

  /** Count the pings a client receives. */
  function pings(ws: WebSocket): { count: number } {
    const seen = { count: 0 };
    ws.on('ping', () => (seen.count += 1));
    return seen;
  }

  /**
   * One client ping and its pong. Frames arrive in order both ways, so once it
   * resolves the client has read everything the server sent before answering —
   * a heartbeat ping included. Rejects if the socket closes instead, so a
   * terminated socket fails the test rather than hanging it.
   */
  function roundTrip(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      ws.once('pong', () => resolve());
      ws.once('close', (code) => reject(new Error(`socket closed with ${code}`)));
      ws.ping();
    });
  }

  /**
   * Two round trips: after the first the client has read the heartbeat's ping
   * and sent its answer, after the second the server has read that answer. One
   * is not enough — the answer leaves after the client's own ping, so the
   * server can reply before it has seen it.
   */
  async function settle(ws: WebSocket): Promise<void> {
    await roundTrip(ws);
    await roundTrip(ws);
  }

  function closed(ws: WebSocket): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket was not closed')), 2000);
      ws.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  it('pings every 25 seconds', async () => {
    const alice = await connectAs(ALICE);
    const seen = pings(alice);

    vi.advanceTimersByTime(24_999);
    await roundTrip(alice);
    expect(seen.count).toBe(0);

    vi.advanceTimersByTime(1);
    await roundTrip(alice);
    expect(seen.count).toBe(1);
  });

  it('terminates a socket that stops answering, and keeps one that answers', async () => {
    const silent = await connectAs(ALICE, { autoPong: false });
    const live = await connectAs(BOB);
    const silentPings = pings(silent);
    const livePings = pings(live);
    const silentClosed = closed(silent);

    vi.advanceTimersByTime(25_000);
    await settle(silent);
    await settle(live);
    // Both were pinged; only `live` answered.
    expect(silentPings.count).toBe(1);
    expect(livePings.count).toBe(1);

    vi.advanceTimersByTime(25_000);

    // 1006: terminated, no close frame — the peer was not going to answer one.
    expect(await silentClosed).toBe(1006);
    await waitFor(() => wsClientCount() === 1);
    expect(wsUserCount()).toBe(1);

    // The answering socket survives this sweep and the ones after it.
    for (let sweep = 0; sweep < 3; sweep++) {
      await settle(live);
      vi.advanceTimersByTime(25_000);
    }
    await settle(live);
    expect(live.readyState).toBe(WebSocket.OPEN);
    expect(livePings.count).toBe(5);
  });

  it('stops the heartbeat on shutdown', () => {
    expect(vi.getTimerCount()).toBe(1);

    shutdownWebSocket();

    // A live interval would keep sweeping a registry nobody uses, and keep the
    // process from exiting on its own.
    expect(vi.getTimerCount()).toBe(0);
  });
});
