import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

/**
 * `GET /api/ready`, the probe that takes this process out of rotation.
 *
 * Two properties. It turns 503 the moment shutdown begins, so the load
 * balancer stops sending requests the process is about to drop. And it never
 * asks the database: this process also serves the SPA and the WebSockets, so a
 * readiness check that failed on a database blip would blank the app for
 * everyone over a few failed queries. The database here is one that throws on
 * any use at all.
 *
 * Draining cannot be undone within a process, so the draining case runs last.
 */

vi.mock('./lib/prisma.js', () => ({
  prisma: new Proxy({}, {
    get() {
      throw new Error('the database is unreachable');
    },
  }),
}));

const { app } = await import('./app.js');
const { startDraining } = await import('./lib/lifecycle.js');

describe('GET /api/ready', () => {
  it('answers 200 without a session, and without the database', async () => {
    const res = await request(app).get('/api/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('answers 503 once the process is draining, while /api/health stays 200', async () => {
    // Liveness and readiness must disagree here: a 503 on /api/health would
    // have the pod restarted mid-drain instead of left to finish.
    startDraining();

    const ready = await request(app).get('/api/ready');
    const health = await request(app).get('/api/health');

    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: 'draining' });
    expect(health.status).toBe(200);
  });
});
