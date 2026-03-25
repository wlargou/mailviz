import { prisma } from '../lib/prisma.js';

export type AuditAction =
  // Email actions
  | 'EMAIL_SENT'
  | 'EMAIL_REPLY'
  | 'EMAIL_FORWARD'
  | 'EMAIL_TRASHED'
  | 'EMAIL_UNTRASHED'
  | 'EMAIL_ARCHIVED'
  | 'EMAIL_UNARCHIVED'
  | 'EMAIL_MARK_READ'
  | 'EMAIL_MARK_UNREAD'
  | 'EMAIL_STARRED'
  | 'EMAIL_UNSTARRED'
  | 'EMAIL_BATCH_TRASH'
  | 'EMAIL_BATCH_ARCHIVE'
  | 'EMAIL_BATCH_MARK_READ'
  | 'EMAIL_BATCH_MARK_UNREAD'
  | 'EMAIL_SCHEDULED'
  | 'EMAIL_SCHEDULE_CANCELLED'
  | 'EMAIL_SCHEDULE_SENT'
  | 'EMAIL_SHARED'
  | 'EMAIL_UNSHARED'
  | 'EMAIL_CONVERTED_TO_TASK'
  // Task actions
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_DELETED'
  | 'TASK_SHARED'
  | 'TASK_ASSIGNED'
  // Deal actions
  | 'DEAL_CREATED'
  | 'DEAL_UPDATED'
  | 'DEAL_DELETED'
  | 'DEAL_SHARED'
  // Calendar actions
  | 'EVENT_CREATED'
  | 'EVENT_UPDATED'
  | 'EVENT_DELETED'
  | 'EVENT_RESPONDED'
  // Company/Contact actions
  | 'COMPANY_CREATED'
  | 'COMPANY_UPDATED'
  | 'COMPANY_DELETED'
  | 'CONTACT_CREATED'
  | 'CONTACT_UPDATED'
  | 'CONTACT_DELETED'
  // Auth actions
  | 'GOOGLE_CONNECTED'
  | 'GOOGLE_DISCONNECTED'
  | 'USER_LOGIN'
  | 'USER_LOGOUT';

export type EntityType = 'email' | 'task' | 'deal' | 'event' | 'company' | 'contact' | 'auth' | 'scheduled_email';

interface AuditLogInput {
  userId: string;
  action: AuditAction;
  entityType: EntityType;
  entityId?: string | null;
  details?: Record<string, unknown>;
  status?: 'success' | 'failure';
}

export const auditService = {
  /**
   * Log an action to the audit trail.
   * Non-blocking — fires and forgets to avoid slowing down the main operation.
   */
  log(input: AuditLogInput): void {
    prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId || null,
        details: input.details || null,
        status: input.status || 'success',
      },
    }).catch((err) => {
      console.warn('[AuditLog] Failed to write audit log:', err?.message || err);
    });
  },

  /**
   * Log with await — for critical operations where we need confirmation.
   */
  async logSync(input: AuditLogInput): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId || null,
        details: input.details || null,
        status: input.status || 'success',
      },
    });
  },

  /**
   * Query audit logs with filtering and pagination.
   */
  async findAll(userId: string, query: {
    page?: number;
    limit?: number;
    action?: string;
    entityType?: string;
    entityId?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 50));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { userId };

    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;

    if (query.dateFrom || query.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (query.dateFrom) createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) createdAt.lte = new Date(query.dateTo);
      where.createdAt = createdAt;
    }

    // Search in JSON details (PostgreSQL JSONB)
    if (query.search) {
      where.OR = [
        { details: { path: ['subject'], string_contains: query.search } },
        { details: { path: ['to'], string_contains: query.search } },
        { details: { path: ['title'], string_contains: query.search } },
        { details: { path: ['name'], string_contains: query.search } },
        { entityId: { contains: query.search } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          details: true,
          status: true,
          createdAt: true,
          user: { select: { id: true, email: true, name: true } },
        },
      }),
      prisma.auditLog.count({ where: where as any }),
    ]);

    return {
      data: logs,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Get a single audit log entry by ID.
   */
  async findById(userId: string, id: string) {
    return prisma.auditLog.findFirst({
      where: { id, userId },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        details: true,
        status: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });
  },
};
