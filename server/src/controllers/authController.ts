import { Response, NextFunction } from 'express';
import type { Req } from "../types/http.js";
import { syncAccountNow } from '../jobs/emailSyncScheduler.js';
import { syncCalendarNow } from '../jobs/calendarSyncScheduler.js';
import { googleAuthService } from '../services/googleAuthService.js';
import { env } from '../config/env.js';
import { signAccessToken, signRefreshToken } from '../utils/jwt.js';
import { setAuthCookies, clearAuthCookies } from '../utils/cookies.js';
import { prisma } from '../lib/prisma.js';

export const authController = {
  // ── Login flow ──

  async getLoginGoogleUrl(_req: Req, res: Response, next: NextFunction) {
    try {
      const url = await googleAuthService.getAuthUrl('login');
      res.json({ data: { url } });
    } catch (err) {
      next(err);
    }
  },

  // ── Session ──

  async getMe(req: Req, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, avatarUrl: true },
      });
      if (!user) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
        return;
      }
      res.json({ data: user });
    } catch (err) {
      next(err);
    }
  },

  async logout(_req: Req, res: Response, next: NextFunction) {
    try {
      clearAuthCookies(res);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },

  // ── Google integration (connect Gmail/Calendar) ──

  async getGoogleUrl(req: Req, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const url = await googleAuthService.getAuthUrl('connect', userId);
      res.json({ data: { url } });
    } catch (err) {
      next(err);
    }
  },

  async googleCallback(req: Req, res: Response, next: NextFunction) {
    try {
      const { code, state } = req.query;
      if (!code || typeof code !== 'string') {
        res.redirect(`${env.CLIENT_URL}/login?error=missing_code`);
        return;
      }

      const stateStr = typeof state === 'string' ? state : '';

      // Exchange code for tokens and user info
      const result = await googleAuthService.exchangeCodeForTokens(code);

      if (stateStr === 'login') {
        // ── Login flow ──
        if (!result.email) {
          res.redirect(`${env.CLIENT_URL}/login?error=no_email`);
          return;
        }

        // Check if email is allowed (skip check if ALLOWED_EMAILS is empty — open access)
        if (env.ALLOWED_EMAILS.length > 0) {
          const isAllowed = env.ALLOWED_EMAILS.some(
            (allowed) => allowed.toLowerCase() === result.email!.toLowerCase()
          );
          if (!isAllowed) {
            res.redirect(`${env.CLIENT_URL}/login?error=unauthorized`);
            return;
          }
        }

        // Upsert user
        const user = await prisma.user.upsert({
          where: { email: result.email },
          create: {
            email: result.email,
            name: result.name || null,
            avatarUrl: result.avatarUrl || null,
          },
          update: {
            name: result.name || undefined,
            avatarUrl: result.avatarUrl || undefined,
          },
        });

        // Store Google auth tokens linked to user
        await googleAuthService.upsertGoogleAuth(user.id, result.tokens);

        // Start syncing immediately rather than waiting for the next scheduler
        // tick. A new account otherwise sits empty for up to a full interval
        // while onboarding tells the user their mail is already on its way.
        //
        // Deliberately not awaited: a first sync can run for hours, and the
        // browser is waiting on this redirect. The runner's per-account guard
        // makes a concurrent tick a no-op, so nothing races.
        void syncAccountNow(user.id).catch((err) => {
          console.warn('[Auth] Post-login mail sync failed:', err?.message || err);
        });
        void syncCalendarNow(user.id).catch((err) => {
          console.warn('[Auth] Post-login calendar sync failed:', err?.message || err);
        });

        // Issue JWT cookies
        const accessToken = signAccessToken(user.id);
        const refreshToken = signRefreshToken(user.id);
        setAuthCookies(res, accessToken, refreshToken);

        res.redirect(env.CLIENT_URL);
      } else if (stateStr) {
        // ── Connect flow — verify signed state JWT to extract userId (S2 fix) ──
        const userId = googleAuthService.verifyOAuthState(stateStr);
        if (!userId) {
          res.redirect(`${env.CLIENT_URL}/settings?error=invalid_state`);
          return;
        }
        await googleAuthService.upsertGoogleAuth(userId, result.tokens);
        res.redirect(`${env.CLIENT_URL}/settings?connected=true`);
      } else {
        res.redirect(`${env.CLIENT_URL}/login?error=invalid_state`);
      }
    } catch (err) {
      next(err);
    }
  },

  async getGoogleStatus(req: Req, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const status = await googleAuthService.getStatus(userId);
      res.json({ data: status });
    } catch (err) {
      next(err);
    }
  },

  async disconnectGoogle(req: Req, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      await googleAuthService.disconnect(userId);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },

  async listUsers(req: Req, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const users = await prisma.user.findMany({
        where: { id: { not: userId } },
        select: { id: true, name: true, email: true, avatarUrl: true },
        orderBy: { name: 'asc' },
      });
      res.json({ data: users });
    } catch (err) {
      next(err);
    }
  },

  async getSignature(req: Req, res: Response, next: NextFunction) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { signature: true },
      });
      res.json({ signature: user?.signature || null });
    } catch (err) {
      next(err);
    }
  },

  async updateSignature(req: Req, res: Response, next: NextFunction) {
    try {
      const { signature } = req.body;
      await prisma.user.update({
        where: { id: req.user!.id },
        data: { signature: signature || null },
      });
      res.json({ message: 'Signature updated' });
    } catch (err) {
      next(err);
    }
  },
};
