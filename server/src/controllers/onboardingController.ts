import { Response, NextFunction } from 'express';
import type { Req } from '../types/http.js';
import { onboardingService } from '../services/onboardingService.js';

export const onboardingController = {
  async getStatus(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await onboardingService.getStatus(req.user!.id) });
    } catch (err) {
      next(err);
    }
  },

  async seedTaskStatuses(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await onboardingService.seedDefaultTaskStatuses(req.user!.id) });
    } catch (err) {
      next(err);
    }
  },

  async complete(req: Req, res: Response, next: NextFunction) {
    try {
      const skipped = req.body?.skipped === true;
      res.json({ data: await onboardingService.complete(req.user!.id, { skipped }) });
    } catch (err) {
      next(err);
    }
  },

  async reset(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await onboardingService.reset(req.user!.id) });
    } catch (err) {
      next(err);
    }
  },
};
