import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { CreateDealPartnerInput, UpdateDealPartnerInput } from '../validators/dealPartnerValidator.js';
import { cleanEmptyStrings } from '../utils/shared.js';

export const dealPartnerService = {
  async findAll(userId: string) {
    return prisma.dealPartner.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
  },

  async create(userId: string, data: CreateDealPartnerInput) {
    const cleaned = cleanEmptyStrings(data);
    try {
      return await prisma.dealPartner.create({
        data: { ...cleaned, userId } as any,
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new AppError(409, 'CONFLICT', 'A partner with this name already exists');
      }
      throw err;
    }
  },

  async update(userId: string, id: string, data: UpdateDealPartnerInput) {
    const existing = await prisma.dealPartner.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Deal partner not found');
    }
    const cleaned = cleanEmptyStrings(data);
    try {
      return await prisma.dealPartner.update({
        where: { id },
        data: cleaned,
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new AppError(409, 'CONFLICT', 'A partner with this name already exists');
      }
      throw err;
    }
  },

  async delete(userId: string, id: string) {
    const existing = await prisma.dealPartner.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Deal partner not found');
    }

    const dealCount = await prisma.deal.count({ where: { partnerId: id } });
    if (dealCount > 0) {
      throw new AppError(409, 'CONFLICT', `Cannot delete partner "${existing.name}" — ${dealCount} deal(s) still reference it. Remove or reassign them first.`);
    }

    return prisma.dealPartner.delete({ where: { id } });
  },
};
