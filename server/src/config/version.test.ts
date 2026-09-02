import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { APP_VERSION, STARTED_AT } from './version.js';

/**
 * The version endpoint.
 *
 * It is asked "what is running in production", usually while something is
 * wrong. So the properties that matter are that it answers WITHOUT a session
 * — needing to log in to find out what is deployed makes it useless at the
 * moment it is needed — and that it never becomes the thing that is broken.
 */
describe('GET /api/version', () => {
  it('answers without authentication', async () => {
    const res = await request(app).get('/api/version');

    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(APP_VERSION);
  });

  it('reports a four-part version read from the repo', async () => {
    // `major.minor.patch.build`: the fourth component is what distinguishes a
    // rebuild of the same code from a change to it.
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('says when the process started, so a deploy can be dated', async () => {
    const res = await request(app).get('/api/version');

    expect(res.body.data.startedAt).toBe(STARTED_AT);
    expect(Number.isNaN(Date.parse(res.body.data.startedAt))).toBe(false);
  });

  it('names the environment it believes it is', async () => {
    const res = await request(app).get('/api/version');

    expect(res.body.data.environment).toBe('test');
  });

  it('carries nothing but version metadata', async () => {
    // It is public, so the shape is the security boundary: anything added here
    // is added to the internet.
    const res = await request(app).get('/api/version');

    expect(Object.keys(res.body.data).sort()).toEqual(['environment', 'startedAt', 'version']);
  });
});
