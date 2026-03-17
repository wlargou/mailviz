import { Request, Response, NextFunction } from 'express';
import { googleAuthService } from '../services/googleAuthService.js';
import { env } from '../config/env.js';

export const authController = {
  async getGoogleUrl(_req: Request, res: Response, next: NextFunction) {
    try {
      const url = googleAuthService.getAuthUrl();
      res.json({ data: { url } });
    } catch (err) {
      next(err);
    }
  },

  async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const { code } = req.query;
      if (!code || typeof code !== 'string') {
        res.status(400).json({ error: 'Missing authorization code' });
        return;
      }

      await googleAuthService.handleCallback(code);
      res.redirect(`${env.CLIENT_URL}/settings?connected=true`);
    } catch (err) {
      next(err);
    }
  },

  async getGoogleStatus(_req: Request, res: Response, next: NextFunction) {
    try {
      const status = await googleAuthService.getStatus();
      res.json({ data: status });
    } catch (err) {
      next(err);
    }
  },

  async disconnectGoogle(_req: Request, res: Response, next: NextFunction) {
    try {
      await googleAuthService.disconnect();
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },
};
