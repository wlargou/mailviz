import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

export const taskStatusService = {
  async findAll(userId: string) {
    return prisma.taskStatus.findMany({
      where: { userId },
      orderBy: { position: 'asc' },
    });
  },

  async create(userId: string, data: { name: string; label: string; color?: string }) {
    // Auto-set position to max + 1
    const maxPos = await prisma.taskStatus.aggregate({ where: { userId }, _max: { position: true } });
    const position = (maxPos._max.position ?? -1) + 1;

    return prisma.taskStatus.create({
      data: {
        userId,
        name: data.name.toUpperCase().replace(/\s+/g, '_'),
        label: data.label,
        color: data.color || '#4589ff',
        position,
      },
    });
  },

  async update(userId: string, id: string, data: { label?: string; color?: string }) {
    return prisma.taskStatus.update({
      where: { id, userId },
      data,
    });
  },

  async reorder(userId: string, items: { id: string; position: number }[]) {
    await prisma.$transaction(
      items.map((item) =>
        prisma.taskStatus.update({
          where: { id: item.id, userId },
          data: { position: item.position },
        })
      )
    );
  },

  async delete(userId: string, id: string) {
    const status = await prisma.taskStatus.findUnique({ where: { id, userId } });
    if (!status) throw new AppError(404, 'NOT_FOUND', 'Status not found');

    // Check if any tasks use this status
    const taskCount = await prisma.task.count({ where: { userId, status: status.name } });
    if (taskCount > 0) {
      throw new AppError(409, 'CONFLICT', `Cannot delete status "${status.label}" — ${taskCount} task(s) still use it. Reassign them first.`);
    }

    return prisma.taskStatus.delete({ where: { id, userId } });
  },
};
