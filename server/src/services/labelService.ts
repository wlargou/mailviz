import { prisma } from '../lib/prisma.js';
import { CreateLabelInput, UpdateLabelInput } from '../validators/labelValidator.js';
import { AppError } from '../middleware/errorHandler.js';
import { auditService } from './auditService.js';

export const labelService = {
  async findAll(userId: string) {
    return prisma.label.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { tasks: true } } },
    });
  },

  async create(userId: string, data: CreateLabelInput) {
    const existing = await prisma.label.findUnique({ where: { userId_name: { userId, name: data.name } } });
    if (existing) {
      throw new AppError(409, 'LABEL_EXISTS', `Label "${data.name}" already exists`);
    }
    const label = await prisma.label.create({ data: { ...data, userId } });
    auditService.log({
      userId,
      action: 'LABEL_CREATED',
      entityType: 'label',
      entityId: label.id,
      details: { name: label.name, color: label.color },
    });
    return label;
  },

  async update(userId: string, id: string, data: UpdateLabelInput) {
    const label = await prisma.label.findUnique({ where: { id, userId } });
    if (!label) {
      throw new AppError(404, 'LABEL_NOT_FOUND', 'Label not found');
    }
    if (data.name && data.name !== label.name) {
      const existing = await prisma.label.findUnique({ where: { userId_name: { userId, name: data.name } } });
      if (existing) {
        throw new AppError(409, 'LABEL_EXISTS', `Label "${data.name}" already exists`);
      }
    }
    const updated = await prisma.label.update({ where: { id, userId }, data });
    auditService.log({
      userId,
      action: 'LABEL_UPDATED',
      entityType: 'label',
      entityId: id,
      details: { name: updated.name, previousName: label.name, color: updated.color },
    });
    return updated;
  },

  async delete(userId: string, id: string) {
    const label = await prisma.label.findUnique({
      where: { id, userId },
      include: { _count: { select: { tasks: true } } },
    });
    if (!label) {
      throw new AppError(404, 'LABEL_NOT_FOUND', 'Label not found');
    }
    const deleted = await prisma.label.delete({ where: { id, userId } });
    // TaskLabel cascades on delete, so this silently detaches the label from
    // every task that had it. Record how many were affected — that is the part
    // you cannot reconstruct after the fact.
    auditService.log({
      userId,
      action: 'LABEL_DELETED',
      entityType: 'label',
      entityId: id,
      details: { name: label.name, detachedFromTasks: label._count.tasks },
    });
    return deleted;
  },
};
