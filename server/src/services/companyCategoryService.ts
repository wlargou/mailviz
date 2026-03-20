import { prisma } from '../lib/prisma.js';

export const companyCategoryService = {
  async findAll() {
    return prisma.companyCategory.findMany({
      orderBy: { position: 'asc' },
    });
  },

  async create(data: { name: string; label: string; color?: string }) {
    // Auto-set position to max + 1
    const maxPos = await prisma.companyCategory.aggregate({ _max: { position: true } });
    const position = (maxPos._max.position ?? -1) + 1;

    return prisma.companyCategory.create({
      data: {
        name: data.name.toUpperCase().replace(/\s+/g, '_'),
        label: data.label,
        color: data.color || '#4589ff',
        position,
      },
    });
  },

  async update(id: string, data: { label?: string; color?: string }) {
    return prisma.companyCategory.update({
      where: { id },
      data,
    });
  },

  async reorder(items: { id: string; position: number }[]) {
    await prisma.$transaction(
      items.map((item) =>
        prisma.companyCategory.update({
          where: { id: item.id },
          data: { position: item.position },
        })
      )
    );
  },

  async delete(id: string) {
    const category = await prisma.companyCategory.findUnique({ where: { id } });
    if (!category) throw Object.assign(new Error('Category not found'), { status: 404 });

    // Check if any customers use this category
    const customerCount = await prisma.customer.count({ where: { categoryId: id } });
    if (customerCount > 0) {
      throw Object.assign(
        new Error(`Cannot delete category "${category.label}" — ${customerCount} company(ies) still use it. Reassign them first.`),
        { status: 409 }
      );
    }

    return prisma.companyCategory.delete({ where: { id } });
  },
};
