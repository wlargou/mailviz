import { Request, Response, NextFunction } from 'express';
import { dashboardService } from '../services/dashboardService.js';

export const dashboardController = {
  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await dashboardService.getStats(req.user!.id);
      res.json({ data: stats });
    } catch (err) {
      next(err);
    }
  },
};
