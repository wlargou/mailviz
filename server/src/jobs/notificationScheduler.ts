import * as cron from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { notificationService } from '../services/notificationService.js';

let isRunning = false;
let task: ReturnType<typeof cron.schedule> | null = null;

async function runNotificationCheck() {
  if (isRunning) {
    console.log('[NotificationScheduler] Skipping — check already in progress');
    return;
  }

  isRunning = true;
  try {
    const authRecords = await prisma.googleAuth.findMany({ select: { userId: true } });
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in15min = new Date(now.getTime() + 15 * 60 * 1000);
    const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    for (const { userId } of authRecords) {
      try {
        // a. Overdue tasks
        const overdueTasks = await prisma.task.findMany({
          where: {
            userId,
            dueDate: { lt: now },
            status: { not: 'DONE' },
          },
          select: { id: true, title: true },
        });
        for (const t of overdueTasks) {
          await notificationService.createIfNotExists(userId, {
            type: 'TASK_OVERDUE',
            title: `Task overdue: ${t.title}`,
            entityType: 'task',
            entityId: t.id,
          });
        }

        // b. Tasks due within 24h
        const dueSoonTasks = await prisma.task.findMany({
          where: {
            userId,
            dueDate: { gte: now, lte: in24h },
            status: { not: 'DONE' },
          },
          select: { id: true, title: true },
        });
        for (const t of dueSoonTasks) {
          await notificationService.createIfNotExists(userId, {
            type: 'TASK_DUE_SOON',
            title: `Task due soon: ${t.title}`,
            entityType: 'task',
            entityId: t.id,
          });
        }

        // c. Events starting within 15 min
        const upcomingEvents = await prisma.calendarEvent.findMany({
          where: {
            userId,
            startTime: { gte: now, lte: in15min },
          },
          select: { id: true, title: true },
        });
        for (const e of upcomingEvents) {
          await notificationService.createIfNotExists(userId, {
            type: 'EVENT_STARTING',
            title: `Starting soon: ${e.title}`,
            entityType: 'event',
            entityId: e.id,
          });
        }

        // d. Deals expiring within 3 days
        const expiringDeals = await prisma.deal.findMany({
          where: {
            userId,
            expiryDate: { gte: now, lte: in3days },
            status: { not: 'DECLINED' },
          },
          select: { id: true, title: true },
        });
        for (const d of expiringDeals) {
          await notificationService.createIfNotExists(userId, {
            type: 'DEAL_EXPIRING',
            title: `Deal expiring: ${d.title}`,
            entityType: 'deal',
            entityId: d.id,
          });
        }

        // e. Deals expired
        const expiredDeals = await prisma.deal.findMany({
          where: {
            userId,
            expiryDate: { lt: now },
            status: { not: 'DECLINED' },
          },
          select: { id: true, title: true },
        });
        for (const d of expiredDeals) {
          await notificationService.createIfNotExists(userId, {
            type: 'DEAL_EXPIRED',
            title: `Deal expired: ${d.title}`,
            entityType: 'deal',
            entityId: d.id,
          });
        }
      } catch (err: any) {
        console.error(`[NotificationScheduler] Error for user ${userId}:`, err?.message || err);
      }
    }
  } catch (err: any) {
    console.error('[NotificationScheduler] Scheduler error:', err?.message || err);
  } finally {
    isRunning = false;
  }
}

export function startNotificationScheduler() {
  // Every 5 minutes
  console.log('[NotificationScheduler] Starting notification check every 5 minutes');
  task = cron.schedule('*/5 * * * *', runNotificationCheck);

  // Run initial check 10 seconds after startup
  setTimeout(runNotificationCheck, 10_000);
}

export function stopNotificationScheduler() {
  if (task) {
    task.stop();
    task = null;
    console.log('[NotificationScheduler] Notification scheduler stopped');
  }
}
