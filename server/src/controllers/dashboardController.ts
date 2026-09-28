import { repliesOwed } from '../services/repliesOwedService.js';
import { readinessOf } from '../services/rfpService.js';
import { isAtRisk } from '../utils/rfpRisk.js';
import { RFP_TERMINAL_STATUSES } from '../utils/rfp.js';
import { getSharedRfpIds } from '../utils/accessControl.js';
import { Response, NextFunction } from 'express';
import type { Req } from "../types/http.js";
import { dashboardService } from '../services/dashboardService.js';
import { prisma } from '../lib/prisma.js';
import { resolveTimeZone, startOfDayInZone, addDaysInZone } from '../utils/timezone.js';
import { terminalStatusNames, notTerminal } from '../utils/taskStatus.js';

/** Tenders the caller can open that are behind — the RFPs badge. */
async function countRfpsAtRisk(userId: string, now: Date): Promise<number> {
  const shared = await getSharedRfpIds(userId);
  const live = await prisma.rfp.findMany({
    where: {
      AND: [
        { OR: [{ userId }, ...(shared.length ? [{ id: { in: shared } }] : [])] },
        { status: { notIn: [...RFP_TERMINAL_STATUSES, 'SUBMITTED'] } },
      ],
    },
    select: { id: true, status: true, deadlineAt: true, createdAt: true, publishedAt: true },
  });
  const readiness = await readinessOf(live.map((r) => r.id));
  return live.filter((r) => isAtRisk(r, readiness.get(r.id) ?? { ready: 0, total: 0 }, now.getTime())).length;
}

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

      const [unreadEmails, overdueTasks, expiringDeals, eventsToday, owed, rfpsAtRisk] = await Promise.all([
        prisma.email.count({ where: { userId, isRead: false } }),
        prisma.task.count({
          where: { userId, ...notTerminal(await terminalStatusNames(userId)), dueDate: { lt: now } },
        }),
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
        // The Mail badge: people waiting on a reply, not unread messages.
        repliesOwed(userId, now).then((r) => r.length),
        countRfpsAtRisk(userId, now),
      ]);

      res.json({ data: { unreadEmails, overdueTasks, expiringDeals, eventsToday, repliesOwed: owed, rfpsAtRisk } });
    } catch (err) {
      next(err);
    }
  },
};
