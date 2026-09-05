import { Prisma } from '../lib/prismaClient.js';
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
  | 'TASK_CHECKLIST_UPDATED'
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
  | 'USER_LOGOUT'
  // First-run setup
  | 'ONBOARDING_COMPLETED'
  | 'ONBOARDING_SKIPPED';

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

/**
 * Writes started by `log()` that have not settled yet.
 *
 * `log()` is deliberately fire-and-forget, which means its INSERT can still be
 * running after the request that started it has been answered. That is fine in
 * production right up until something else wants the database to hold still:
 * on shutdown the process can exit with audit rows unwritten, and in tests the
 * per-test TRUNCATE deadlocks against the in-flight INSERT's foreign-key lock.
 *
 * Keeping the handles costs one Set entry per write and makes both cases
 * addressable via `flush()`.
 */
const pendingWrites = new Set<Promise<unknown>>();

export const auditService = {
  /**
   * Log an action to the audit trail.
   * Non-blocking — fires and forgets to avoid slowing down the main operation.
   */
  log(input: AuditLogInput): void {
    const write = prisma.auditLog.create({
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

    pendingWrites.add(write);
    void write.finally(() => pendingWrites.delete(write));
  },

  /**
   * Wait for every fire-and-forget write to settle.
   *
   * Never rejects — `log()` already swallows its own failures, so this only
   * reports that nothing is still in flight, not that everything succeeded.
   *
   * Bounded, and it drops the handles either way. A write whose connection is
   * torn down mid-flight (`prisma.$disconnect()` while an INSERT is running)
   * leaves a promise that never settles, and an unbounded wait on one of those
   * would wedge every later flush — which is exactly what happened: the test
   * file *after* a route-heavy one timed out in every single `beforeEach`.
   * These writes are fire-and-forget by construction; their caller returned
   * long ago, so abandoning one costs nothing beyond the row.
   */
  async flush(timeoutMs = 2000): Promise<void> {
    if (pendingWrites.size === 0) return;

    const draining = [...pendingWrites];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(draining),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      draining.forEach((write) => pendingWrites.delete(write));
    }
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
        // `id` breaks the tie. Audit rows are written in bursts — a batch
        // action logs several within the same millisecond — and timestamp(3)
        // makes those compare equal, so an unstable sort under LIMIT/OFFSET can
        // show one entry on two pages and never show another. The codebase
        // already documents this rule; the activity log was simply missed.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
