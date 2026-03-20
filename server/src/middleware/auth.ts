import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, verifyRefreshToken, signAccessToken } from '../utils/jwt.js';
import { setAuthCookies } from '../utils/cookies.js';
import { prisma } from '../lib/prisma.js';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const accessToken = req.cookies?.access_token;
  const refreshToken = req.cookies?.refresh_token;

  // Try access token first
  if (accessToken) {
    try {
      const payload = verifyAccessToken(accessToken);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (user) {
        req.user = { id: user.id, email: user.email };
        return next();
      }
    } catch {
      // Access token expired or invalid — fall through to refresh
    }
  }

  // Try refresh token
  if (refreshToken) {
    try {
      const payload = verifyRefreshToken(refreshToken);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (user) {
        // Issue new access token
        const newAccessToken = signAccessToken(user.id);
        setAuthCookies(res, newAccessToken, refreshToken);
        req.user = { id: user.id, email: user.email };
        return next();
      }
    } catch {
      // Refresh token also invalid
    }
  }

  res.status(401).json({
    error: {
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    },
  });
}
