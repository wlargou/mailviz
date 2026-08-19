import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const isProduction = env.NODE_ENV === 'production';

const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long the browser should keep the refresh cookie: exactly as long as the
 * token inside it is still valid.
 *
 * This used to be a flat 7 days on every call, but `requireAuth` re-sends the
 * *same* refresh JWT when it mints a new access token — its `exp` does not move.
 * So a user active on day 6 got a cookie stamped good for another week wrapped
 * around a token that expired the next day, and the session ended with a 401
 * mid-action instead of the browser quietly dropping an expired cookie.
 *
 * Deriving the max-age from `exp` keeps the 7-day cap on a session (deliberate:
 * with no reuse detection, rotating the token on every request would remove the
 * absolute bound without buying anything) while letting the cookie tell the
 * truth about it.
 */
function refreshCookieMaxAge(refreshToken: string): number {
  const decoded = jwt.decode(refreshToken);
  const exp = typeof decoded === 'object' && decoded !== null ? decoded.exp : undefined;
  if (typeof exp !== 'number') return REFRESH_MAX_AGE_MS;
  // Floor at 0: a negative max-age is a session cookie, which would outlive the
  // token it carries — the opposite of what an already-expired token wants.
  return Math.max(0, exp * 1000 - Date.now());
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000, // 15 minutes
    path: '/',
  });

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: refreshCookieMaxAge(refreshToken),
    path: '/',
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/' });
}
