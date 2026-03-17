import { Request, Response, NextFunction } from 'express';
import { dashboardService } from '../services/dashboardService.js';

export const dashboardController = {
  async getStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await dashboardService.getStats();
      res.json({ data: stats });
    } catch (err) {
      next(err);
    }
  },
};
