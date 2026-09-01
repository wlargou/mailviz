import { Response, NextFunction } from 'express';
import type { Req } from "../types/http.js";
import { dashboardService } from '../services/dashboardService.js';
import { prisma } from '../lib/prisma.js';
import { resolveTimeZone, startOfDayInZone, addDaysInZone } from '../utils/timezone.js';

export const dashboardController = {
  async getStats(req: Req, res: Response, next: NextFunction) {
    try {
      const stats = await dashboardService.getStats(req.user!.id);
      res.json({ data: stats });
    } catch (err) {
      next(err);
    }
  },

  /** Lightweight badge counts for sidebar navigation */
  async getNavCounts(req: Req, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const now = new Date();
      // The sidebar's "events today" badge is the user's today, not the
      // server's — the same UTC-midnight assumption the dashboard had.
      const owner = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
      const tz = resolveTimeZone(owner?.timezone);
      const startOfToday = startOfDayInZone(now, tz);
      const endOfToday = addDaysInZone(startOfToday, 1, tz);
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
