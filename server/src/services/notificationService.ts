import { prisma } from '../lib/prisma.js';
import { wsEmitToUser } from '../websocket.js';

interface CreateNotificationInput {
  type: string;
  title: string;
  message?: string;
  entityType?: string;
  entityId?: string;
}

/**
 * How long a dismissal suppresses the same notification being raised again.
 *
 * A day: long enough that dismissing something clears it for the working day,
 * short enough that a genuinely overdue task comes back tomorrow rather than
 * being silenced for good.
 */
export const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const notificationService = {
  async create(userId: string, data: CreateNotificationInput) {
    const notification = await prisma.notification.create({
      data: {
        userId,
        type: data.type,
        title: data.title,
        message: data.message ?? null,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
      },
    });

    wsEmitToUser(userId, 'notification:new', notification);

    return notification;
  },

  /**
   * Raise a notification unless one is already standing, or was dismissed
   * recently.
   *
   * Two suppressions, and they exist for different reasons.
   *
   * The first is the standing one: an undismissed notification for the same
   * entity means the user has already been told. That was the only check here.
   *
   * The second is the cooldown, and it is the one this needed. Dismissing a
   * notification cleared the first check, so the scheduler recreated it on its
   * next five-minute tick — for ever, until the underlying task was dealt with.
   * Recreation IS deliberate (an overdue task is still overdue tomorrow, and
   * the reminder should return), but five minutes later is not a reminder, it
   * is nagging. `DISMISS_COOLDOWN_MS` is how long "I have seen this" lasts.
   *
   * A null `dismissedAt` means the row was dismissed before that column
   * existed, and is deliberately outside the cooldown: those notifications keep
   * behaving exactly as they did rather than being suppressed by a timestamp
   * they never had.
   */
  async createIfNotExists(userId: string, data: CreateNotificationInput) {
    if (!data.entityId) {
      return this.create(userId, data);
    }

    const standing = await prisma.notification.findFirst({
      where: {
        userId,
        type: data.type,
        entityId: data.entityId,
        isDismissed: false,
      },
    });

    if (standing) return standing;

    const recentlyDismissed = await prisma.notification.findFirst({
      where: {
        userId,
        type: data.type,
        entityId: data.entityId,
        isDismissed: true,
        dismissedAt: { gte: new Date(Date.now() - DISMISS_COOLDOWN_MS) },
      },
      orderBy: { dismissedAt: 'desc' },
    });

    if (recentlyDismissed) return recentlyDismissed;

    return this.create(userId, data);
  },

  async findAll(userId: string, query: { page?: number; limit?: number; unreadOnly?: boolean }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {
      userId,
      isDismissed: false,
    };

    if (query.unreadOnly) {
      where.isRead = false;
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where }),
    ]);

    return {
      data: notifications,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async getUnreadCount(userId: string) {
    return prisma.notification.count({
      where: {
        userId,
        isRead: false,
        isDismissed: false,
      },
    });
  },

  async markRead(userId: string, id: string) {
    return prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
  },

  async markAllRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, isRead: false, isDismissed: false },
      data: { isRead: true },
    });
  },

  async dismiss(userId: string, id: string) {
    return prisma.notification.updateMany({
      where: { id, userId },
      data: { isDismissed: true, dismissedAt: new Date() },
    });
  },

  /**
   * "Clear read" — dismissing an unread notification would throw away
   * something the user has never seen. The client mirrors this by removing
   * only read rows and leaving the badge alone.
   */
  async dismissAll(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, isRead: true, isDismissed: false },
      data: { isDismissed: true, dismissedAt: new Date() },
    });
  },

};
