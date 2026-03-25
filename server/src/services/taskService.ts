import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CreateTaskInput, UpdateTaskInput, ReorderInput } from '../validators/taskValidator.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { AppError } from '../middleware/errorHandler.js';
import { getSharedTaskIds, canAccessTask, isTaskOwner } from '../utils/accessControl.js';
import { wsEmitToUsers, wsEmitToUser } from '../websocket.js';
import { auditService } from './auditService.js';

interface TaskQueryParams {
  status?: string;
  statusNot?: string;
  priority?: string;
  search?: string;
  labelId?: string;
  customerId?: string;
  dueBefore?: string;
  dueAfter?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: string;
  limit?: string;
}

export const taskService = {
  async findAll(userId: string, query: TaskQueryParams) {
    const pagination = parsePagination(query);

    // Include shared + assigned tasks
    const sharedTaskIds = await getSharedTaskIds(userId);
    const where: Prisma.TaskWhereInput = {
      OR: [
        { userId },
        ...(sharedTaskIds.length > 0 ? [{ id: { in: sharedTaskIds } }] : []),
        { assignedToId: userId },
      ],
    };

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

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = (query.sortOrder || 'desc') as Prisma.SortOrder;
    const orderBy: Prisma.TaskOrderByWithRelationInput = { [sortBy]: sortOrder };

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

  async assignTask(userId: string, taskId: string, assignedToId: string | null) {
    const hasAccess = await canAccessTask(taskId, userId);
    if (!hasAccess) throw Object.assign(new Error('Task not found'), { status: 404 });

    const task = await prisma.task.update({
      where: { id: taskId },
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
