import { Prisma } from '@prisma/client';
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
  | 'EMAIL_SCHEDULE_UPDATED'
  | 'EMAIL_SCHEDULE_SENT'
  | 'EMAIL_SHARED'
  | 'EMAIL_UNSHARED'
  | 'EMAIL_CONVERTED_TO_TASK'
  | 'EMAIL_DRAFT_SAVED'
  | 'EMAIL_DRAFT_DELETED'
  | 'EMAIL_DRAFT_SENT'
  | 'EMAIL_SNOOZED'
  | 'EMAIL_UNSNOOZED'
  | 'EMAIL_FOLLOW_UP_SET'
  | 'EMAIL_FOLLOW_UP_CLEARED'
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
  | 'CONTACT_MERGED'
  // Email template / snippet actions
  | 'TEMPLATE_CREATED'
  | 'TEMPLATE_UPDATED'
  | 'TEMPLATE_DELETED'
  // Label actions
  | 'LABEL_CREATED'
  | 'LABEL_UPDATED'
  | 'LABEL_DELETED'
  // Auth actions
  | 'GOOGLE_CONNECTED'
  | 'GOOGLE_DISCONNECTED'
  | 'USER_LOGIN'
  | 'USER_LOGOUT';

export type EntityType = 'email' | 'task' | 'deal' | 'event' | 'company' | 'contact' | 'label' | 'auth' | 'scheduled_email' | 'email_draft' | 'email_template';

/**
 * Anything that can write an audit row — the shared client or a transaction
 * client handed out by `prisma.$transaction`.
 */
type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;

interface AuditLogInput {
  userId: string;
  action: AuditAction;
  entityType: EntityType;
  entityId?: string | null;
  // Must be JSON-serialisable — `Record<string, unknown>` is not assignable to
  // Prisma's InputJsonValue because `unknown` admits non-JSON values.
  details?: Prisma.InputJsonObject;
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
        // Prisma needs Prisma.DbNull (not JS null) to write SQL NULL to a Json? column.
        details: input.details ?? Prisma.DbNull,
        status: input.status || 'success',
      },
    }).catch((err) => {
      console.warn('[AuditLog] Failed to write audit log:', err?.message || err);
    });
  },

  /**
   * Log with await — for critical operations where we need confirmation.
   *
   * Pass the transaction client for an operation that must not be able to
   * commit without its audit row. Contact merges do: they delete rows whose
   * contents exist nowhere else afterwards, so the record of what was destroyed
   * has to land or roll back with the deletion itself.
   */
  async logSync(input: AuditLogInput, client: AuditClient = prisma): Promise<void> {
    await client.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId || null,
        // Prisma needs Prisma.DbNull (not JS null) to write SQL NULL to a Json? column.
        details: input.details ?? Prisma.DbNull,
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
