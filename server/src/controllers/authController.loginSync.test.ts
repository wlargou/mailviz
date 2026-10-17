import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import type { Req } from '../types/http.js';
import { env } from '../config/env.js';

/**
 * The sync a sign-in starts, and RUN_SCHEDULERS.
 *
 * A login kicks off a mail and a calendar sync for that account at once, so a
 * new account is not empty for a whole interval. That is background work like
 * any scheduler tick, and a process told not to run background work — staging
 * on a copy of production, where a sync would act on real mailboxes — must not
 * run it through the back door of somebody signing in.
 *
 * Google and the sync runners are mocked; the user upsert is real.
 */

const mocks = vi.hoisted(() => ({
  syncAccountNow: vi.fn<(userId: string) => Promise<void>>(),
  syncCalendarNow: vi.fn<(userId: string) => Promise<void>>(),
}));

vi.mock('../jobs/emailSyncScheduler.js', () => ({ syncAccountNow: mocks.syncAccountNow }));
vi.mock('../jobs/calendarSyncScheduler.js', () => ({ syncCalendarNow: mocks.syncCalendarNow }));
vi.mock('../services/onboardingService.js', () => ({
  onboardingService: { ensureAccountDefaults: vi.fn(async () => {}) },
}));
vi.mock('../services/googleAuthService.js', () => ({
  googleAuthService: {
    exchangeCodeForTokens: vi.fn(async () => ({
      email: 'signing.in@example.com',
      name: 'Signing In',
      avatarUrl: null,
      tokens: { access_token: 'a', refresh_token: 'r', expiry_date: Date.now() + 3_600_000 },
    })),
    upsertGoogleAuth: vi.fn(async () => {}),
  },
}));

const { authController } = await import('./authController.js');
const { pendingJobs } = await import('../lib/lifecycle.js');

const saved = { RUN_SCHEDULERS: env.RUN_SCHEDULERS, ALLOWED_EMAILS: env.ALLOWED_EMAILS };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.syncAccountNow.mockResolvedValue(undefined);
  mocks.syncCalendarNow.mockResolvedValue(undefined);
  env.ALLOWED_EMAILS = [];
});

afterEach(() => {
  env.RUN_SCHEDULERS = saved.RUN_SCHEDULERS;
  env.ALLOWED_EMAILS = saved.ALLOWED_EMAILS;
});

async function signIn() {
  const req = { query: { code: 'auth-code', state: 'login' } } as unknown as Req;
  const res = { redirect: vi.fn(), cookie: vi.fn() };
  const next = vi.fn();
  await authController.googleCallback(req, res as unknown as Response, next as unknown as NextFunction);
  expect(next).not.toHaveBeenCalled();
  // Signed in either way: the switch is about background work, not the login.
  expect(res.redirect).toHaveBeenCalledWith(env.CLIENT_URL);
  expect(res.cookie).toHaveBeenCalled();
}

describe('the sync a sign-in starts', () => {
  it('runs when this process runs background jobs', async () => {
    env.RUN_SCHEDULERS = true;

    await signIn();

    expect(mocks.syncAccountNow).toHaveBeenCalledTimes(1);
    expect(mocks.syncCalendarNow).toHaveBeenCalledTimes(1);
  });

  it('is tracked, so a shutdown waits for it like a scheduler tick', async () => {
    env.RUN_SCHEDULERS = true;
    let finish!: () => void;
    const held = new Promise<void>((resolve) => { finish = resolve; });
    mocks.syncAccountNow.mockImplementation(() => held.then(() => {}));
    mocks.syncCalendarNow.mockImplementation(() => held.then(() => {}));

    await signIn();
    expect(pendingJobs()).toBe(2);

    finish();
    await vi.waitFor(() => expect(pendingJobs()).toBe(0));
  });

  it('is skipped when RUN_SCHEDULERS is false', async () => {
    env.RUN_SCHEDULERS = false;

    await signIn();

    expect(mocks.syncAccountNow).not.toHaveBeenCalled();
    expect(mocks.syncCalendarNow).not.toHaveBeenCalled();
  });
});
