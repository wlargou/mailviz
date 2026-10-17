import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, request, Agent, type Server, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Shutdown, as SIGTERM sees it.
 *
 * The handler used to stop the crons, disconnect and exit on the spot, so a
 * scheduled send half-way through was cut off between Gmail accepting the
 * message and the row being marked sent — and went out again after the
 * restart. Railway does that at every deploy; Kubernetes at every rollout.
 *
 * Draining is module state (one process, one shutdown), so each test loads a
 * fresh copy of the module.
 */

type Lifecycle = typeof import('./lifecycle.js');
let lifecycle: Lifecycle;

beforeEach(async () => {
  vi.resetModules();
  lifecycle = await import('./lifecycle.js');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Whether a promise has settled, without waiting for it. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => { done = true; }, () => { done = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  return done;
}

describe('drain', () => {
  it('waits for a tracked job to finish', async () => {
    const job = deferred();
    lifecycle.trackJob(job.promise);

    const drained = lifecycle.drain(5_000);
    expect(await settled(drained)).toBe(false);

    job.resolve();
    expect(await drained).toBe(true);
  });

  it('gives up at the deadline rather than waiting for ever', async () => {
    // Kubernetes kills the pod at the end of its grace period regardless; a
    // drain that outlives it never reaches the disconnect at all.
    vi.useFakeTimers();
    lifecycle.trackJob(new Promise(() => {}));

    const drained = lifecycle.drain(1_000);
    await vi.advanceTimersByTimeAsync(999);
    expect(await Promise.race([drained, Promise.resolve('waiting')])).toBe('waiting');

    await vi.advanceTimersByTimeAsync(1);
    expect(await drained).toBe(false);
  });

  it('counts a job that failed as finished', async () => {
    const failed = Promise.reject(new Error('sync blew up'));
    lifecycle.trackJob(failed).catch(() => {});

    expect(await lifecycle.drain(1_000)).toBe(true);
  });

  it('also waits for a job tracked while it was already waiting', async () => {
    const first = deferred();
    const second = deferred();
    lifecycle.trackJob(first.promise);
    const drained = lifecycle.drain(5_000);

    lifecycle.trackJob(second.promise);
    first.resolve();
    expect(await settled(drained)).toBe(false);

    second.resolve();
    expect(await drained).toBe(true);
  });

  it('marks the process as draining', async () => {
    expect(lifecycle.isDraining()).toBe(false);

    await lifecycle.drain(0);

    expect(lifecycle.isDraining()).toBe(true);
  });
});

describe('runJob', () => {
  it('tracks the job it starts until it settles', async () => {
    const job = deferred();

    const running = lifecycle.runJob(() => job.promise);
    expect(lifecycle.pendingJobs()).toBe(1);

    job.resolve();
    await running;
    expect(lifecycle.pendingJobs()).toBe(0);
  });

  it('starts nothing once draining', async () => {
    // The boot-time first runs are setTimeouts that stopping the crons does
    // not cancel: one firing mid-drain must not start a sync.
    const start = vi.fn(async () => {});
    lifecycle.startDraining();

    await lifecycle.runJob(start);

    expect(start).not.toHaveBeenCalled();
  });
});

describe('configureHttpServer', () => {
  it('outlasts a 60-second load-balancer idle timeout', () => {
    // At Node's default 5 s, the proxy reuses a socket Node is closing and the
    // client gets a 502 for a request the app never saw.
    const server = createServer();

    lifecycle.configureHttpServer(server);

    expect(server.keepAliveTimeout).toBe(65_000);
    expect(server.headersTimeout).toBe(66_000);
  });
});

describe('closeHttpServer', () => {
  let server: Server;
  let agent: Agent;
  let releaseSlow: () => void;

  beforeEach(async () => {
    const slow = deferred();
    releaseSlow = slow.resolve;
    server = createServer((req, res) => {
      if (req.url === '/slow') void slow.promise.then(() => res.end('finished'));
      else if (req.url === '/forever') res.write('started');
      else res.end('ok');
    });
    // As in production: a keep-alive socket that just served a request would
    // otherwise hold close() open for 65 s.
    lifecycle.configureHttpServer(server);
    agent = new Agent({ keepAlive: true });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(() => {
    agent.destroy();
    server.closeAllConnections();
    server.close();
  });

  function get(path: string): Promise<{ status: number; body: string }> {
    const { port } = server.address() as AddressInfo;
    return new Promise((resolve, reject) => {
      request({ host: '127.0.0.1', port, path, agent }, (res: IncomingMessage) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        res.on('error', reject);
      }).on('error', reject).end();
    });
  }

  it('lets a request in flight finish, then closes', async () => {
    await get('/'); // leaves an idle keep-alive socket behind
    const inFlight = get('/slow');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const closing = lifecycle.closeHttpServer(server, 5_000);
    expect(await settled(closing)).toBe(false);

    releaseSlow();
    expect(await inFlight).toEqual({ status: 200, body: 'finished' });
    expect(await closing).toBe(true);
  });

  it('refuses new connections once closing', async () => {
    const { port } = server.address() as AddressInfo;
    const inFlight = get('/slow');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const closing = lifecycle.closeHttpServer(server, 5_000);
    const refused = new Promise<string>((resolve) => {
      request({ host: '127.0.0.1', port, path: '/' }, () => resolve('served'))
        .on('error', (err: NodeJS.ErrnoException) => resolve(err.code ?? 'error'))
        .end();
    });
    expect(await refused).toBe('ECONNREFUSED');

    releaseSlow();
    await inFlight;
    await closing;
  });

  it('cuts what is still open at the deadline', async () => {
    const neverEnds = get('/forever').catch((err: Error) => err.message);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await lifecycle.closeHttpServer(server, 100)).toBe(false);
    expect(await neverEnds).toMatch(/aborted|hang up|ECONNRESET/i);
  });
});

describe('createShutdown', () => {
  function steps(overrides: Partial<import('./lifecycle.js').ShutdownSteps> = {}) {
    const order: string[] = [];
    const s = {
      order,
      stopSchedulers: vi.fn(() => { order.push('stopSchedulers'); }),
      closeHttp: vi.fn(async (_ms: number) => { order.push('closeHttp'); return true; }),
      closeWebSocket: vi.fn(() => { order.push('closeWebSocket'); }),
      disconnect: vi.fn(async () => { order.push('disconnect'); }),
      exit: vi.fn((code: number) => { order.push(`exit(${code})`); }),
      ...overrides,
    };
    return s;
  }

  it('drains a running job before closing anything — REGRESSION', async () => {
    // The old handler disconnected and exited at once, cutting a scheduled
    // send off between Gmail accepting it and the row being marked sent.
    const s = steps();
    const job = deferred();
    lifecycle.trackJob(job.promise);

    const done = lifecycle.createShutdown(s, 5_000)('SIGTERM');
    expect(await settled(done)).toBe(false);
    expect(lifecycle.isDraining()).toBe(true);
    expect(s.order).toEqual(['stopSchedulers']);

    job.resolve();
    await done;
    expect(s.order).toEqual(['stopSchedulers', 'closeHttp', 'closeWebSocket', 'disconnect', 'exit(0)']);
  });

  it('closes the WebSockets while waiting for the HTTP server, not after', async () => {
    // An open socket holds server.close() until the deadline: awaiting the
    // HTTP close first would spend the whole budget whenever a tab is open.
    const wsClosed = deferred();
    const s = steps({
      closeHttp: vi.fn(async () => { await wsClosed.promise; return true; }),
      closeWebSocket: vi.fn(() => { wsClosed.resolve(); }),
    });

    await lifecycle.createShutdown(s, 5_000)('SIGTERM');

    expect(s.exit).toHaveBeenCalledWith(0);
  });

  it('still exits when a job outlives the deadline, and gives the HTTP close only what is left', async () => {
    const s = steps();
    lifecycle.trackJob(new Promise(() => {}));
    const started = Date.now();

    await lifecycle.createShutdown(s, 100)('SIGTERM');

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(s.exit).toHaveBeenCalledWith(0);
    expect(vi.mocked(s.closeHttp).mock.calls[0][0]).toBeLessThanOrEqual(5);
  });

  it('exits at once on a second signal', async () => {
    const s = steps();
    lifecycle.trackJob(new Promise(() => {}));
    const shutdown = lifecycle.createShutdown(s, 5_000);

    void shutdown('SIGTERM');
    await shutdown('SIGINT');

    expect(s.exit).toHaveBeenCalledWith(1);
    expect(s.closeHttp).not.toHaveBeenCalled();
  });
});
