import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { CreateDealInput, UpdateDealInput } from '../validators/dealValidator.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { cleanEmptyStrings } from '../utils/shared.js';
import { getSharedDealIds, canAccessDeal, isDealOwner } from '../utils/accessControl.js';

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

    // Include shared deals
    const sharedDealIds = await getSharedDealIds(userId);
    const ownershipFilter: Prisma.DealWhereInput = sharedDealIds.length > 0
      ? { OR: [{ userId }, { id: { in: sharedDealIds } }] }
      : { userId };
    const where: Prisma.DealWhereInput = { ...ownershipFilter };

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
    // First try owned
    let deal = await prisma.deal.findFirst({
      where: { id, userId },
      include: dealIncludes,
    });
    // If not owned, check shared access
    if (!deal && await canAccessDeal(id, userId)) {
      deal = await prisma.deal.findFirst({
        where: { id },
        include: dealIncludes,
      });
    }
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
    const hasAccess = await canAccessDeal(id, userId);
    if (!hasAccess) {
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
    const isOwner = await isDealOwner(id, userId);
    if (!isOwner) {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal not found');
    }
    await prisma.deal.delete({ where: { id } });
    return { success: true };
  },

  async shareDeal(userId: string, dealId: string, recipientUserIds: string[]) {
    const isOwner = await isDealOwner(dealId, userId);
    if (!isOwner) throw Object.assign(new Error('Deal not found'), { status: 404 });

    const validIds = recipientUserIds.filter(id => id !== userId);
    if (validIds.length === 0) throw Object.assign(new Error('Cannot share with yourself'), { status: 400 });

    await prisma.dealShare.createMany({
      data: validIds.map(recipientId => ({
        dealId,
        sharedByUserId: userId,
        sharedWithUserId: recipientId,
      })),
      skipDuplicates: true,
    });

    // Get sharer's name for notification
    const [sharer, deal] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
      prisma.deal.findFirst({ where: { id: dealId }, select: { title: true } }),
    ]);

    const { wsEmitToUsers } = await import('../websocket.js');
    wsEmitToUsers(validIds, 'deal:shared', {
      dealId,
      sharedBy: { name: sharer?.name, email: sharer?.email },
      title: deal?.title,
    });

    return { success: true, sharedWith: validIds.length };
  },

  async unshareDeal(userId: string, dealId: string, recipientUserId: string) {
    await prisma.dealShare.deleteMany({
      where: { dealId, sharedByUserId: userId, sharedWithUserId: recipientUserId },
    });
    return { success: true };
  },

  async getDealShares(userId: string, dealId: string) {
    const isOwner = await isDealOwner(dealId, userId);
    if (!isOwner) throw Object.assign(new Error('Deal not found'), { status: 404 });

    const shares = await prisma.dealShare.findMany({
      where: { dealId, sharedByUserId: userId },
      include: { sharedWith: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return shares;
  },
};
