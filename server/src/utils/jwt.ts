import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

interface TokenPayload {
  sub: string;
  type: 'access' | 'refresh';
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'access' } as TokenPayload, env.JWT_SECRET, {
    expiresIn: '15m',
  });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'refresh' } as TokenPayload, env.JWT_REFRESH_SECRET, {
    expiresIn: '7d',
  });
}

/**
 * Verify a token *and* that it is the kind of token the caller asked for.
 *
 * Both tokens have carried a `type` claim since they were introduced, and
 * nothing ever read it: the two kinds were kept apart only by being signed with
 * different secrets. That holds right up until someone sets `JWT_SECRET` and
 * `JWT_REFRESH_SECRET` to the same value — an easy thing to do when provisioning
 * an environment, and silent when it happens. At that point the 7-day refresh
 * token, which the browser sends on every single request, is accepted anywhere
 * a 15-minute access token is, and the short access-token lifetime stops meaning
 * anything.
 *
 * Checking the claim costs one comparison and makes the guarantee independent of
 * how the secrets happen to be configured.
 */
function verify(token: string, secret: string, expected: TokenPayload['type']): TokenPayload {
  const payload = jwt.verify(token, secret);
  if (typeof payload === 'string' || payload.type !== expected) {
    throw new jwt.JsonWebTokenError(`Expected a ${expected} token`);
  }
  return payload as TokenPayload;
}

export function verifyAccessToken(token: string): TokenPayload {
  return verify(token, env.JWT_SECRET, 'access');
}

export function verifyRefreshToken(token: string): TokenPayload {
  return verify(token, env.JWT_REFRESH_SECRET, 'refresh');
}
