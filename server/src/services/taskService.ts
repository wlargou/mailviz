import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { CreateTaskInput, UpdateTaskInput, ReorderInput } from '../validators/taskValidator.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { AppError } from '../middleware/errorHandler.js';
import { getSharedTaskIds, canAccessTask, isTaskOwner } from '../utils/accessControl.js';
import { wsEmitToUsers, wsEmitToUser } from '../websocket.js';
import { auditService } from './auditService.js';
import { notificationService } from './notificationService.js';

interface TaskQueryParams {
  status?: string;
  statusNot?: string;
  priority?: string;
  search?: string;
  labelId?: string;
  customerId?: string;
  dueBefore?: string;
  dueAfter?: string;
  /** 'shared' = only rows this user does not own, 'owned' = only rows they own. */
  ownership?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: string;
  limit?: string;
}

// Whitelist of sortable Task columns. `sortBy` comes straight off the query
// string and is used as a Prisma orderBy key, so it must never be trusted raw.
// `position` is here because the Kanban board sorts by it.
const TASK_SORT_FIELDS = ['title', 'status', 'priority', 'dueDate', 'position', 'createdAt', 'updatedAt'] as const;

/**
 * A task may only ever point at rows owned by the same account.
 *
 * `customerId` and `labelIds` arrive in the request body and are plain foreign
 * keys into user-scoped tables, so the database accepts another account's id
 * without complaint. The cost is not just a malformed row: `create`/`update`
 * include `customer` and `labels` in what they return, so the response echoes
 * another account's company record — notes and all — back to the caller.
 *
 * `ownerId` is the owner of the task being written, not the caller: a user a
 * task was shared with or assigned must not be able to attach their own
 * company to someone else's task either.
 */
async function assertReferencesOwnedBy(
  ownerId: string,
  data: { customerId?: string | null; labelIds?: string[] }
) {
  if (data.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: data.customerId, userId: ownerId },
      select: { id: true },
    });
    if (!customer) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
  }
  if (data.labelIds && data.labelIds.length > 0) {
    const ids = [...new Set(data.labelIds)];
    const owned = await prisma.label.count({ where: { id: { in: ids }, userId: ownerId } });
    if (owned !== ids.length) {
      throw new AppError(404, 'LABEL_NOT_FOUND', 'Label not found');
    }
  }
}

export const taskService = {
  async findAll(userId: string, query: TaskQueryParams) {
    const pagination = parsePagination(query);

    // Include shared + assigned tasks
    const sharedTaskIds = await getSharedTaskIds(userId);
    const ownershipFilter: Prisma.TaskWhereInput = {
      OR: [
        { userId },
        ...(sharedTaskIds.length > 0 ? [{ id: { in: sharedTaskIds } }] : []),
        { assignedToId: userId },
      ],
    };
    // Ownership lives under `AND`, not at the top level, so that a filter
    // branch below can never overwrite it by assigning `where.OR`. That is
    // exactly how the cross-tenant leak in dealService.findAll happened.
    const where: Prisma.TaskWhereInput = { AND: [ownershipFilter] };

    if (query.status) {
      where.status = query.status;
    }
    if (query.statusNot) {
      where.status = { not: query.statusNot };
    }
    if (query.priority) {
      where.priority = query.priority as Prisma.EnumTaskPriorityFilter;
    }
    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }
    if (query.labelId) {
      where.labels = { some: { labelId: query.labelId } };
    }
    if (query.customerId) {
      where.customerId = query.customerId;
    }
    if (query.dueBefore || query.dueAfter) {
      where.dueDate = {};
      if (query.dueBefore) where.dueDate.lte = new Date(query.dueBefore);
      if (query.dueAfter) where.dueDate.gte = new Date(query.dueAfter);
    }
    // "Shared with me" / "Owned by me" narrowing. This only ever restricts the
    // access-controlled OR above — it never widens what the user can see.
    if (query.ownership === 'shared') {
      where.userId = { not: userId };
    } else if (query.ownership === 'owned') {
      where.userId = userId;
    }

    const requestedSort = query.sortBy || 'createdAt';
    const sortBy = (TASK_SORT_FIELDS as readonly string[]).includes(requestedSort)
      ? requestedSort
      : 'createdAt';
    const sortOrder: Prisma.SortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.TaskOrderByWithRelationInput[] = [
      { [sortBy]: sortOrder },
      { id: 'asc' },
    ];
    /**
     * `id` is the tiebreaker, and it is not optional.
     *
     * Every page is a separate `LIMIT`/`OFFSET` query. When rows tie on the sort
     * column, Postgres is free to return them in a different order each time — so
     * a row can appear on page 1 and again on page 3 while another is never
     * reachable at all. On this data that is not a corner case: 3,499 of 11,694
     * contacts share an empty surname, one tie group about 175 pages deep.
     */

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy,
        skip: pagination.skip,
        take: pagination.limit,
        include: { labels: { include: { label: true } }, customer: true },
      }),
      prisma.task.count({ where }),
    ]);

    return {
      data: tasks.map(formatTask),
      meta: paginationMeta(total, pagination),
    };
  },

  async findById(userId: string, id: string) {
    const hasAccess = await canAccessTask(id, userId);
    if (!hasAccess) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        labels: { include: { label: true } },
        customer: true,
        mailToTask: {
          include: {
            email: {
              select: { id: true, subject: true, from: true, fromName: true, threadId: true, receivedAt: true },
            },
          },
        },
      },
    });
    if (!task) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    return formatTask(task);
  },

  async getSummary(userId: string) {
    const now = new Date();

    // Include shared + assigned tasks in summary
    const sharedTaskIds = await getSharedTaskIds(userId);
    const summaryWhere: Prisma.TaskWhereInput = {
      OR: [
        { userId },
        ...(sharedTaskIds.length > 0 ? [{ id: { in: sharedTaskIds } }] : []),
        { assignedToId: userId },
      ],
    };

    const [total, completed, overdue, byPriority] = await Promise.all([
      prisma.task.count({ where: summaryWhere }),
      prisma.task.count({ where: { ...summaryWhere, status: 'DONE' } }),
      prisma.task.count({
        where: {
          ...summaryWhere,
          status: { not: 'DONE' },
          dueDate: { lt: now },
        },
      }),
      prisma.task.groupBy({
        by: ['priority'],
        where: summaryWhere,
        _count: { priority: true },
      }),
    ]);

    const priorityMap: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };
    byPriority.forEach((p) => {
      priorityMap[p.priority] = p._count.priority;
    });

    return {
      total,
      completed,
      overdue,
      inProgress: total - completed,
      byPriority: priorityMap,
    };
  },

  async create(userId: string, data: CreateTaskInput) {
    await assertReferencesOwnedBy(userId, data);
    const { labelIds, customerId, assignedToId, ...taskData } = data;

    // Get max position for the status column
    const maxPos = await prisma.task.findFirst({
      where: { userId, status: taskData.status || 'TODO' },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = (maxPos?.position ?? 0) + 1000;

    const task = await prisma.task.create({
      data: {
        ...taskData,
        userId,
        dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
        position,
        customerId: customerId || null,
        assignedToId: assignedToId || null,
        labels: labelIds?.length
          ? { create: labelIds.map((labelId) => ({ labelId })) }
          : undefined,
      } as any,
      include: { labels: { include: { label: true } }, customer: true },
    });

    auditService.log({ userId, action: 'TASK_CREATED', entityType: 'task', entityId: task.id, details: { title: data.title, status: data.status, priority: data.priority } });

    return formatTask(task);
  },

  async update(userId: string, id: string, data: UpdateTaskInput) {
    const hasAccess = await canAccessTask(id, userId);
    if (!hasAccess) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    await assertReferencesOwnedBy(existing.userId, data);

    const { labelIds, customerId, ...taskData } = data;

    const updateData: any = {
      ...taskData,
    };

    if (taskData.dueDate !== undefined) {
      updateData.dueDate = taskData.dueDate ? new Date(taskData.dueDate) : null;
    }

    if (customerId !== undefined) {
      updateData.customerId = customerId || null;
    }

    if (labelIds !== undefined) {
      // Replace all labels
      await prisma.taskLabel.deleteMany({ where: { taskId: id } });
      if (labelIds.length > 0) {
        await prisma.taskLabel.createMany({
          data: labelIds.map((labelId) => ({ taskId: id, labelId })),
        });
      }
    }

    const task = await prisma.task.update({
      where: { id },
      data: updateData,
      include: { labels: { include: { label: true } }, customer: true },
    });

    auditService.log({ userId, action: 'TASK_UPDATED', entityType: 'task', entityId: id, details: { changes: Object.keys(data) } });

    return formatTask(task);
  },

  async reorder(userId: string, data: ReorderInput) {
    // Checked up front so an id the caller does not own — a stale board, or
    // another account's task — is a 404. The per-row `update` below still
    // carries `userId`, but on its own it raises an unhandled P2025 that the
    // error handler can only turn into a 500.
    const ids = [...new Set(data.items.map((item) => item.id))];
    if (ids.length > 0) {
      const owned = await prisma.task.count({ where: { id: { in: ids }, userId } });
      if (owned !== ids.length) {
        throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
      }
    }
    const operations = data.items.map((item) =>
      prisma.task.update({
        where: { id: item.id, userId },
        data: { status: item.status, position: item.position },
      })
    );
    await prisma.$transaction(operations);
    return { success: true };
  },

  async delete(userId: string, id: string) {
    const owner = await isTaskOwner(id, userId);
    if (!owner) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const existing = await prisma.task.findUnique({ where: { id }, select: { title: true } });
    await prisma.task.delete({ where: { id } });
    auditService.log({ userId, action: 'TASK_DELETED', entityType: 'task', entityId: id, details: { title: existing?.title } });
    return { success: true };
  },

  async shareTask(userId: string, taskId: string, recipientUserIds: string[]) {
    const owner = await isTaskOwner(taskId, userId);
    if (!owner) throw Object.assign(new Error('Task not found'), { status: 404 });

    const validIds = recipientUserIds.filter(id => id !== userId);
    if (validIds.length === 0) throw Object.assign(new Error('Cannot share with yourself'), { status: 400 });

    await prisma.taskShare.createMany({
      data: validIds.map(recipientId => ({
        taskId,
        sharedByUserId: userId,
        sharedWithUserId: recipientId,
      })),
      skipDuplicates: true,
    });

    // Get sharer's name for notification
    const [sharer, task] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
      prisma.task.findFirst({ where: { id: taskId }, select: { title: true } }),
    ]);

    wsEmitToUsers(validIds, 'task:shared', {
      taskId,
      sharedBy: { name: sharer?.name, email: sharer?.email },
      title: task?.title,
    });

    auditService.log({ userId, action: 'TASK_SHARED', entityType: 'task', entityId: taskId, details: { sharedWith: recipientUserIds } });

    for (const recipientUserId of validIds) {
      await notificationService.create(recipientUserId, {
        type: 'TASK_SHARED',
        title: `Task shared: ${task?.title}`,
        message: `shared a task with you`,
        entityType: 'task',
        entityId: taskId,
      });
    }

    return { success: true, sharedWith: validIds.length };
  },

  async unshareTask(userId: string, taskId: string, recipientUserId: string) {
    await prisma.taskShare.deleteMany({
      where: { taskId, sharedByUserId: userId, sharedWithUserId: recipientUserId },
    });
    return { success: true };
  },

  async getTaskShares(userId: string, taskId: string) {
    const owner = await isTaskOwner(taskId, userId);
    if (!owner) throw Object.assign(new Error('Task not found'), { status: 404 });

    const shares = await prisma.taskShare.findMany({
      where: { taskId, sharedByUserId: userId },
      include: { sharedWith: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return shares;
  },

  /**
   * Assignment is an owner-only power, not an access-level one.
   *
   * This used to gate on `canAccessTask`, which is satisfied by a share or by
   * being the current assignee — so anyone the owner shared a task with could
   * assign it onward to a third account. That grants standing access (the
   * assignee sees the task through `assignedToId` forever) to somebody the
   * owner never chose, and revoking the original share does not take it back.
   *
   * Every other privileged operation on a task already gates on ownership —
   * `shareTask`, `delete`, `reorder` — so this is the outlier being brought
   * into line, not a new restriction.
   */
  async assignTask(userId: string, taskId: string, assignedToId: string | null) {
    const isOwner = await isTaskOwner(taskId, userId);
    if (!isOwner) throw Object.assign(new Error('Task not found'), { status: 404 });

    // The assignee must be a real account. Without this the column becomes a
    // sink for any uuid the caller invents.
    if (assignedToId) {
      const assignee = await prisma.user.findUnique({
        where: { id: assignedToId },
        select: { id: true },
      });
      if (!assignee) throw Object.assign(new Error('User not found'), { status: 404 });
    }

    const task = await prisma.task.update({
      where: { id: taskId, userId },
      data: { assignedToId },
      include: { labels: { include: { label: true } }, customer: true },
    });

    // Notify the assignee if assigned to someone else
    if (assignedToId && assignedToId !== userId) {
      const assigner = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      wsEmitToUser(assignedToId, 'task:assigned', {
        taskId,
        title: task.title,
        assignedBy: { name: assigner?.name, email: assigner?.email },
      });
    }

    auditService.log({ userId, action: 'TASK_ASSIGNED', entityType: 'task', entityId: taskId, details: { assignedToId } });

    if (assignedToId && assignedToId !== userId) {
      await notificationService.create(assignedToId, {
        type: 'TASK_ASSIGNED',
        title: `Task assigned: ${task.title}`,
        message: `assigned a task to you`,
        entityType: 'task',
        entityId: taskId,
      });
    }

    return formatTask(task);
  },
};

function formatTask(task: any) {
  return {
    ...task,
    labels: task.labels?.map((tl: any) => tl.label) || [],
    customer: task.customer || null,
  };
}
