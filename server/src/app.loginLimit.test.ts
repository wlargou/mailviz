import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './app.js';

/**
 * The sign-in limiter's size.
 *
 * Behind a cluster's load balancer every client can arrive from the
 * balancer's address, so the limiter's one bucket is shared by everybody. At
 * the old 20 per 15 minutes, a couple of people signing in and out could lock
 * each other out; 60 is the agreed size for a shared bucket. Read from the
 * header rather than by exhausting the bucket, which would leak into whatever
 * runs next.
 */
describe('the sign-in rate limit', () => {
  it('allows 60 attempts per window on the OAuth callback and the login URL', async () => {
    const callback = await request(app).get('/api/v1/auth/google/callback');
    const loginUrl = await request(app).get('/api/v1/auth/login/google/url');

    expect(callback.headers['x-ratelimit-limit']).toBe('60');
    expect(loginUrl.headers['x-ratelimit-limit']).toBe('60');
  });
});
