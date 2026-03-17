import { PrismaClient } from '@prisma/client';
import { CreateLabelInput, UpdateLabelInput } from '../validators/labelValidator.js';
import { AppError } from '../middleware/errorHandler.js';

const prisma = new PrismaClient();

export const labelService = {
  async findAll() {
    return prisma.label.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { tasks: true } } },
    });
  },

  async create(data: CreateLabelInput) {
    const existing = await prisma.label.findUnique({ where: { name: data.name } });
    if (existing) {
      throw new AppError(409, 'LABEL_EXISTS', `Label "${data.name}" already exists`);
    }
    return prisma.label.create({ data });
  },

  async update(id: string, data: UpdateLabelInput) {
    const label = await prisma.label.findUnique({ where: { id } });
    if (!label) {
      throw new AppError(404, 'LABEL_NOT_FOUND', 'Label not found');
    }
    if (data.name && data.name !== label.name) {
      const existing = await prisma.label.findUnique({ where: { name: data.name } });
      if (existing) {
        throw new AppError(409, 'LABEL_EXISTS', `Label "${data.name}" already exists`);
      }
    }
    return prisma.label.update({ where: { id }, data });
  },

  async delete(id: string) {
    const label = await prisma.label.findUnique({ where: { id } });
    if (!label) {
      throw new AppError(404, 'LABEL_NOT_FOUND', 'Label not found');
    }
    return prisma.label.delete({ where: { id } });
  },
};
