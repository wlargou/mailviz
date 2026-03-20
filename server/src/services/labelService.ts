import { prisma } from '../lib/prisma.js';
import { CreateLabelInput, UpdateLabelInput } from '../validators/labelValidator.js';
import { AppError } from '../middleware/errorHandler.js';

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
    return prisma.label.create({ data: { ...data, userId } });
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
    return prisma.label.update({ where: { id, userId }, data });
  },

  async delete(userId: string, id: string) {
    const label = await prisma.label.findUnique({ where: { id, userId } });
    if (!label) {
      throw new AppError(404, 'LABEL_NOT_FOUND', 'Label not found');
    }
    return prisma.label.delete({ where: { id, userId } });
  },
};
