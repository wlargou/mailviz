import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app } from './app.js';

/**
 * The access log leaves out the platform's probes.
 *
 * A liveness or readiness probe arrives every few seconds for the life of the
 * process; logged, it is most of the log and says nothing. Everything else is
 * still logged, which the control request below proves — without it, a capture
 * that saw nothing at all would pass this file just as well.
 */

let spy: ReturnType<typeof vi.spyOn> | undefined;

afterEach(() => {
  spy?.mockRestore();
  spy = undefined;
});

/** Lines morgan wrote to stdout since the capture began. It calls through, so nothing is hidden. */
function captureStdout(): () => string[] {
  const s = vi.spyOn(process.stdout, 'write');
  spy = s;
  return () => s.mock.calls.map(([chunk]) => String(chunk));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('access log', () => {
  it('skips /api/health and /api/ready, and logs the rest', async () => {
    const lines = captureStdout();

    await request(app).get('/api/health');
    await request(app).get('/api/health?probe=liveness');
    // Not a route on this branch; skipped by path all the same.
    await request(app).get('/api/ready');
    // The control: logged, and last, so once it shows up the probes would have.
    await request(app).get('/api/version');
    await waitFor(() => lines().some((l) => l.includes('/api/version')));

    expect(lines().filter((l) => l.includes('/api/health') || l.includes('/api/ready'))).toEqual([]);
  });

  it('skips by path only, not by prefix', async () => {
    const lines = captureStdout();

    // A route that merely starts like a probe is an ordinary request.
    await request(app).get('/api/healthcheck');
    await waitFor(() => lines().some((l) => l.includes('/api/healthcheck')));
  });
});
