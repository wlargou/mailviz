import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { CreateDealInput, UpdateDealInput } from '../validators/dealValidator.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { cleanEmptyStrings } from '../utils/shared.js';

interface DealQueryParams {
  search?: string;
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;
  status?: string;
  partnerId?: string;
}

const dealIncludes = {
  partner: { select: { id: true, name: true, logoUrl: true } },
  customer: { select: { id: true, name: true, logoUrl: true } },
};

export const dealService = {
  async findAll(userId: string, query: DealQueryParams) {
    const pagination = parsePagination(query);

    const where: Prisma.DealWhereInput = { userId };

    if (query.status) {
      where.status = query.status;
    }
    if (query.partnerId) {
      where.partnerId = query.partnerId;
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { products: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = (query.sortOrder || 'desc') as Prisma.SortOrder;

    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: pagination.skip,
        take: pagination.limit,
        include: dealIncludes,
      }),
      prisma.deal.count({ where }),
    ]);

    return {
      data: deals,
      meta: paginationMeta(total, pagination),
    };
  },

  async findById(userId: string, id: string) {
    const deal = await prisma.deal.findFirst({
      where: { id, userId },
      include: dealIncludes,
    });
    if (!deal) {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal not found');
    }
    return deal;
  },

  async create(userId: string, data: CreateDealInput) {
    const cleaned = cleanEmptyStrings(data);
    if (cleaned.expiryDate) {
      cleaned.expiryDate = new Date(cleaned.expiryDate as string);
    }
    return prisma.deal.create({
      data: { ...cleaned, userId } as any,
      include: dealIncludes,
    });
  },

  async update(userId: string, id: string, data: UpdateDealInput) {
    const existing = await prisma.deal.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal not found');
    }
    const cleaned = cleanEmptyStrings(data);
    if (cleaned.expiryDate) {
      cleaned.expiryDate = new Date(cleaned.expiryDate as string);
    }
    return prisma.deal.update({
      where: { id },
      data: cleaned,
      include: dealIncludes,
    });
  },

  async delete(userId: string, id: string) {
    const existing = await prisma.deal.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal not found');
    }
    await prisma.deal.delete({ where: { id } });
    return { success: true };
  },
};
