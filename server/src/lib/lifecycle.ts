import type { Server } from 'http';

/**
 * What a process does between being told to stop and stopping.
 *
 * The shutdown handler used to stop the crons, disconnect Prisma and exit on
 * the spot. A scheduler tick half-way through a send, a sync or a write was
 * cut off wherever it stood, and so was every HTTP request in flight. Railway
 * does that at each deploy; Kubernetes does it at each rollout, drain and
 * eviction, with SIGTERM and a grace period before SIGKILL.
 *
 * So shutdown is a sequence with one deadline: stop taking new work, let the
 * running jobs and requests finish, then close what is left. Every scheduler
 * tick goes through `runJob`, which is what makes "the running jobs" knowable.
 */

/** The whole shutdown budget. Kubernetes' grace period is 45 s, so this ends first. */
export const SHUTDOWN_DEADLINE_MS = 30_000;

let draining = false;
const jobs = new Set<Promise<unknown>>();

/** True once shutdown has begun: `/api/ready` answers 503 and no new job starts. */
export function isDraining(): boolean {
  return draining;
}

export function startDraining(): void {
  draining = true;
}

/** Make shutdown wait for this promise, up to the deadline. */
export function trackJob<T>(job: Promise<T>): Promise<T> {
  jobs.add(job);
  const forget = () => {
    jobs.delete(job);
  };
  job.then(forget, forget);
  return job;
}

/**
 * Start a background job unless the process is draining, and track it.
 *
 * Every scheduler tick and boot-time first run goes through here. The boot-time
 * runs are `setTimeout`s that stopping a cron does not cancel, so without the
 * check a SIGTERM in the first fifteen seconds would start a sync mid-drain.
 */
export function runJob(start: () => Promise<unknown>): Promise<void> {
  if (draining) return Promise.resolve();
  return trackJob(start()).then(() => undefined);
}

/** How many tracked jobs are still running. */
export function pendingJobs(): number {
  return jobs.size;
}

/**
 * Stop new jobs and wait for the running ones, for at most `deadlineMs`.
 *
 * Resolves true when every job settled, false when the deadline came first.
 * A job that fails counts as settled: it has stopped, which is all a shutdown
 * needs to know. Jobs tracked during the wait are waited for too.
 */
export async function drain(deadlineMs: number): Promise<boolean> {
  draining = true;
  const deadline = Date.now() + deadlineMs;

  while (jobs.size > 0) {
    const left = deadline - Date.now();
    if (left <= 0) return false;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), left);
    });
    const outcome = await Promise.race([Promise.allSettled([...jobs]), timedOut]);
    clearTimeout(timer);
    if (outcome === 'timeout') return jobs.size === 0;
  }
  return true;
}

/**
 * Hold idle connections open longer than the load balancer in front does.
 *
 * Node closes an idle keep-alive socket after 5 s. A proxy holding a longer
 * idle timeout (Envoy's and the cloud load balancers' are 60 s) can send a
 * request down a socket at the instant Node closes it, and the client gets a
 * 502 for a request the app never saw. The server's side has to outlast the
 * proxy's, and `headersTimeout` must exceed `keepAliveTimeout` or Node cuts a
 * slow first request on a reused socket.
 */
export function configureHttpServer(server: Server): void {
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}

/**
 * Stop accepting connections and wait for the requests in flight to finish.
 *
 * `server.close()` alone waits for every open socket, and a keep-alive socket
 * that just served a request stays open for `keepAliveTimeout` — 65 s here —
 * so idle ones are closed as soon as they become idle. At the deadline the rest
 * are cut. Upgraded sockets (`/ws`) are not the HTTP server's to close: they
 * keep `close()` from finishing until `shutdownWebSocket` has run.
 *
 * Resolves true when the server closed on its own, false at the deadline.
 */
export function closeHttpServer(server: Server, deadlineMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sweep = setInterval(() => server.closeIdleConnections(), 100);
    const timer = setTimeout(() => {
      server.closeAllConnections();
      finish(false);
    }, deadlineMs);
    let settled = false;
    function finish(closed: boolean) {
      if (settled) return;
      settled = true;
      clearInterval(sweep);
      clearTimeout(timer);
      resolve(closed);
    }

    server.close(() => finish(true));
  });
}

export interface ShutdownSteps {
  stopSchedulers(): void;
  closeHttp(deadlineMs: number): Promise<boolean>;
  closeWebSocket(): void;
  disconnect(): Promise<void>;
  exit(code: number): void;
}

/**
 * The SIGTERM / SIGINT handler: drain, then close, inside one deadline.
 *
 *  1. Draining: `/api/ready` turns 503 and no new job starts.
 *  2. The crons stop.
 *  3. Running jobs finish — a send half-way through is the case that matters.
 *  4. The HTTP server stops accepting and its requests in flight finish. The
 *     WebSocket connections are closed while it waits, not after: an open
 *     socket would otherwise hold `server.close()` until the deadline.
 *  5. Prisma disconnects and the process exits 0.
 *
 * A second signal exits at once — somebody pressing Ctrl+C twice means it.
 */
export function createShutdown(steps: ShutdownSteps, deadlineMs = SHUTDOWN_DEADLINE_MS) {
  let started = false;

  return async function shutdown(signal: string): Promise<void> {
    if (started) {
      console.warn(`[Shutdown] ${signal} again, exiting without waiting`);
      steps.exit(1);
      return;
    }
    started = true;
    const deadline = Date.now() + deadlineMs;
    const left = () => Math.max(0, deadline - Date.now());
    console.log(`[Shutdown] ${signal}: draining, up to ${Math.round(deadlineMs / 1000)}s`);

    // Every step below is bounded except the disconnect; this bounds that too.
    const force = setTimeout(() => {
      console.error('[Shutdown] Still not done after the deadline, exiting');
      steps.exit(1);
    }, deadlineMs + 5_000);
    force.unref();

    try {
      startDraining();
      steps.stopSchedulers();

      if (!(await drain(left()))) {
        console.warn(`[Shutdown] ${pendingJobs()} job(s) still running at the deadline`);
      }

      const httpClosed = steps.closeHttp(left());
      steps.closeWebSocket();
      if (!(await httpClosed)) {
        console.warn('[Shutdown] Requests still open at the deadline were cut');
      }

      await steps.disconnect();
      console.log('[Shutdown] Done');
    } catch (err) {
      console.error('[Shutdown] Failed:', err instanceof Error ? err.message : err);
      steps.exit(1);
      return;
    } finally {
      clearTimeout(force);
    }
    steps.exit(0);
  };
}
