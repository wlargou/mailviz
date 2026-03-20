import { Request, Response, NextFunction } from 'express';
import { dashboardService } from '../services/dashboardService.js';
import { prisma } from '../lib/prisma.js';

export const dashboardController = {
  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await dashboardService.getStats(req.user!.id);
      res.json({ data: stats });
    } catch (err) {
      next(err);
    }
  },

  /** Lightweight badge counts for sidebar navigation */
  async getNavCounts(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfToday = new Date(startOfToday);
      endOfToday.setDate(endOfToday.getDate() + 1);
      const fifteenDaysFromNow = new Date(now);
      fifteenDaysFromNow.setDate(fifteenDaysFromNow.getDate() + 15);

      const [unreadEmails, overdueTasks, expiringDeals, eventsToday] = await Promise.all([
        prisma.email.count({ where: { userId, isRead: false } }),
        prisma.task.count({ where: { userId, status: { not: 'DONE' }, dueDate: { lt: now } } }),
        prisma.deal.count({
          where: {
            userId,
            status: { not: 'DECLINED' },
            expiryDate: { gte: now, lte: fifteenDaysFromNow },
          },
        }),
        prisma.calendarEvent.count({
          where: { userId, startTime: { gte: startOfToday, lt: endOfToday } },
        }),
      ]);

      res.json({ data: { unreadEmails, overdueTasks, expiringDeals, eventsToday } });
    } catch (err) {
      next(err);
    }
  },
};
