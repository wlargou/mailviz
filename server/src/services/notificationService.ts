import { prisma } from '../lib/prisma.js';
import { wsEmitToUser } from '../websocket.js';

interface CreateNotificationInput {
  type: string;
  title: string;
  message?: string;
  entityType?: string;
  entityId?: string;
}

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

  async createIfNotExists(userId: string, data: CreateNotificationInput) {
    if (!data.entityId) {
      return this.create(userId, data);
    }

    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        type: data.type,
        entityId: data.entityId,
        isDismissed: false,
      },
    });

    if (existing) return existing;

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
      data: { isDismissed: true },
    });
  },

  async dismissAll(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, isRead: true, isDismissed: false },
      data: { isDismissed: true },
    });
  },
};
