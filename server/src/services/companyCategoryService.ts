import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

export const companyCategoryService = {
  async findAll(userId: string) {
    return prisma.companyCategory.findMany({
      where: { userId },
      orderBy: { position: 'asc' },
    });
  },

  async create(userId: string, data: { name: string; label: string; color?: string }) {
    // Auto-set position to max + 1
    const maxPos = await prisma.companyCategory.aggregate({ where: { userId }, _max: { position: true } });
    const position = (maxPos._max.position ?? -1) + 1;

    return prisma.companyCategory.create({
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
    return prisma.companyCategory.update({
      where: { id, userId },
      data,
    });
  },

  async reorder(userId: string, items: { id: string; position: number }[]) {
    await prisma.$transaction(
      items.map((item) =>
        prisma.companyCategory.update({
          where: { id: item.id, userId },
          data: { position: item.position },
        })
      )
    );
  },

  async delete(userId: string, id: string) {
    const category = await prisma.companyCategory.findUnique({ where: { id, userId } });
    if (!category) throw new AppError(404, 'NOT_FOUND', 'Category not found');

    // Check if any customers use this category
    const customerCount = await prisma.customer.count({ where: { userId, categoryId: id } });
    if (customerCount > 0) {
      throw new AppError(409, 'CONFLICT', `Cannot delete category "${category.label}" — ${customerCount} company(ies) still use it. Reassign them first.`);
    }

    return prisma.companyCategory.delete({ where: { id, userId } });
  },
};
