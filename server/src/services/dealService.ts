import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { CreateDealInput, UpdateDealInput } from '../validators/dealValidator.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { cleanEmptyStrings } from '../utils/shared.js';
import { getSharedDealIds, canAccessDeal, isDealOwner } from '../utils/accessControl.js';
import { auditService } from './auditService.js';
import { notificationService } from './notificationService.js';

interface DealQueryParams {
  search?: string;
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;
  status?: string;
  partnerId?: string;
  /** 'shared' = only rows this user does not own, 'owned' = only rows they own. */
  ownership?: string;
}

// Whitelist of sortable Deal columns. `sortBy` comes straight off the query
// string and is used as a Prisma orderBy key, so it must never be trusted raw.
const DEAL_SORT_FIELDS = ['title', 'status', 'expiryDate', 'createdAt', 'updatedAt'] as const;

const dealIncludes = {
  partner: { select: { id: true, name: true, logoUrl: true } },
  customer: { select: { id: true, name: true, logoUrl: true } },
};

/**
 * A deal may only ever point at rows owned by the same account.
 *
 * `partnerId` and `customerId` arrive in the request body and are plain foreign
 * keys into user-scoped tables, so the database will happily accept another
 * account's id. It is not only a bad row: `dealIncludes` reads the partner and
 * the company back out, so the create/update response hands the caller the name
 * and logo of a company they have no access to.
 *
 * `ownerId` is the owner of the deal being written, not the caller — a user a
 * deal was shared with must not be able to repoint it at their own partner.
 */
async function assertReferencesOwnedBy(
  ownerId: string,
  data: { partnerId?: string | null; customerId?: string | null }
) {
  if (data.partnerId) {
    const partner = await prisma.dealPartner.findFirst({
      where: { id: data.partnerId, userId: ownerId },
      select: { id: true },
    });
    if (!partner) {
      throw new AppError(404, 'DEAL_PARTNER_NOT_FOUND', 'Deal partner not found');
    }
  }
  if (data.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: data.customerId, userId: ownerId },
      select: { id: true },
    });
    if (!customer) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
  }
}

export const dealService = {
  async findAll(userId: string, query: DealQueryParams) {
    const pagination = parsePagination(query);

    // Include shared deals
    const sharedDealIds = await getSharedDealIds(userId);
    const ownershipFilter: Prisma.DealWhereInput = sharedDealIds.length > 0
      ? { OR: [{ userId }, { id: { in: sharedDealIds } }] }
      : { userId };
    // The ownership filter lives under `AND` so that the search branch below,
    // which assigns `where.OR`, cannot clobber it.
    const where: Prisma.DealWhereInput = { AND: [ownershipFilter] };

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
    // "Shared with me" / "Owned by me" narrowing. This only ever restricts the
    // ownership filter above — it never widens what the user can see.
    if (query.ownership === 'shared') {
      where.userId = { not: userId };
    } else if (query.ownership === 'owned') {
      where.userId = userId;
    }

    const requestedSort = query.sortBy || 'createdAt';
    const sortBy = (DEAL_SORT_FIELDS as readonly string[]).includes(requestedSort)
      ? requestedSort
      : 'createdAt';
    const sortOrder: Prisma.SortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.DealOrderByWithRelationInput[] = [
      { [sortBy]: sortOrder },
      { id: 'asc' },
    ];
    /**
     * `id` is the tiebreaker, and it is not optional.
     *
     * Every page is a separate `LIMIT`/`OFFSET` query. When rows tie on the sort
     * column, Postgres is free to return them in a different order each time — so
     * a row can appear on page 1 and again on page 3 while another is never
     * reachable at all. On this data that is not a corner case: 3,499 of 11,694
     * contacts share an empty surname, one tie group about 175 pages deep.
     */

    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        orderBy,
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
    await assertReferencesOwnedBy(userId, data);
    const cleaned = cleanEmptyStrings(data);
    if (cleaned.expiryDate) {
      cleaned.expiryDate = new Date(cleaned.expiryDate as string);
    }
    const deal = await prisma.deal.create({
      data: { ...cleaned, userId } as any,
      include: dealIncludes,
    });
    auditService.log({ userId, action: 'DEAL_CREATED', entityType: 'deal', entityId: deal.id, details: { title: data.title, partnerId: data.partnerId, status: data.status } });
    return deal;
  },

  async update(userId: string, id: string, data: UpdateDealInput) {
    const hasAccess = await canAccessDeal(id, userId);
    if (!hasAccess) {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal not found');
    }
    const existing = await prisma.deal.findUnique({ where: { id }, select: { userId: true } });
    if (!existing) {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal not found');
    }
    await assertReferencesOwnedBy(existing.userId, data);
    const cleaned = cleanEmptyStrings(data);
    if (cleaned.expiryDate) {
      cleaned.expiryDate = new Date(cleaned.expiryDate as string);
    }
    const deal = await prisma.deal.update({
      where: { id },
      data: cleaned,
      include: dealIncludes,
    });
    auditService.log({ userId, action: 'DEAL_UPDATED', entityType: 'deal', entityId: id, details: { changes: Object.keys(data) } });
    return deal;
  },

  async delete(userId: string, id: string) {
    const isOwner = await isDealOwner(id, userId);
    if (!isOwner) {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal not found');
    }
    const existing = await prisma.deal.findUnique({ where: { id }, select: { title: true } });
    await prisma.deal.delete({ where: { id } });
    auditService.log({ userId, action: 'DEAL_DELETED', entityType: 'deal', entityId: id, details: { title: existing?.title } });
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

    auditService.log({ userId, action: 'DEAL_SHARED', entityType: 'deal', entityId: dealId, details: { sharedWith: recipientUserIds } });

    for (const recipientUserId of validIds) {
      await notificationService.create(recipientUserId, {
        type: 'DEAL_SHARED',
        title: `Deal shared: ${deal?.title}`,
        message: `shared a deal with you`,
        entityType: 'deal',
        entityId: dealId,
      });
    }

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
