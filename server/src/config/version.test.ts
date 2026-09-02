import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { APP_VERSION, RELEASED_AT } from './version.js';

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

  it('dates the release, so "when did this ship" has an answer', async () => {
    const res = await request(app).get('/api/version');

    expect(res.body.data.releasedAt).toBe(RELEASED_AT);
    expect(Number.isNaN(Date.parse(res.body.data.releasedAt))).toBe(false);
  });

  it('carries exactly two fields and nothing else', async () => {
    /**
     * This is served to the internet, so the response shape IS the security
     * boundary — anything added here is published. The environment name and
     * the process start time used to be here and were removed: neither is
     * anyone's business from outside, and neither is what a reader wants.
     *
     * An exact key set rather than a subset check, so a field cannot be added
     * back without this failing.
     */
    const res = await request(app).get('/api/version');

    expect(Object.keys(res.body.data).sort()).toEqual(['releasedAt', 'version']);
  });
});
