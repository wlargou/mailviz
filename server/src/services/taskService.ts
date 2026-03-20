import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CreateTaskInput, UpdateTaskInput, ReorderInput } from '../validators/taskValidator.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { AppError } from '../middleware/errorHandler.js';

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
  async findAll(query: TaskQueryParams) {
    const pagination = parsePagination(query);

    const where: Prisma.TaskWhereInput = {};

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

  async findById(id: string) {
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

  async getSummary() {
    const now = new Date();

    const [total, completed, overdue, byPriority] = await Promise.all([
      prisma.task.count(),
      prisma.task.count({ where: { status: 'DONE' } }),
      prisma.task.count({
        where: {
          status: { not: 'DONE' },
          dueDate: { lt: now },
        },
      }),
      prisma.task.groupBy({
        by: ['priority'],
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

  async create(data: CreateTaskInput) {
    const { labelIds, customerId, ...taskData } = data;

    // Get max position for the status column
    const maxPos = await prisma.task.findFirst({
      where: { status: taskData.status || 'TODO' },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = (maxPos?.position ?? 0) + 1000;

    const task = await prisma.task.create({
      data: {
        ...taskData,
        dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
        position,
        customerId: customerId || null,
        labels: labelIds?.length
          ? { create: labelIds.map((labelId) => ({ labelId })) }
          : undefined,
      } as any,
      include: { labels: { include: { label: true } }, customer: true },
    });

    return formatTask(task);
  },

  async update(id: string, data: UpdateTaskInput) {
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

    return formatTask(task);
  },

  async reorder(data: ReorderInput) {
    const operations = data.items.map((item) =>
      prisma.task.update({
        where: { id: item.id },
        data: { status: item.status, position: item.position },
      })
    );
    await prisma.$transaction(operations);
    return { success: true };
  },

  async delete(id: string) {
    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    await prisma.task.delete({ where: { id } });
    return { success: true };
  },
};

function formatTask(task: any) {
  return {
    ...task,
    labels: task.labels?.map((tl: any) => tl.label) || [],
    customer: task.customer || null,
  };
}
