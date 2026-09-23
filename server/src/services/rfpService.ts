import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { auditService } from './auditService.js';
import { removeStoredFile } from './rfpStorage.js';
import { canAccessRfp, getSharedRfpIds, isRfpOwner } from '../utils/accessControl.js';
import { notificationService } from './notificationService.js';
import { RFP_TERMINAL_STATUSES, type RfpDocumentKind } from '../utils/rfp.js';
import type { CreateRfpInput, UpdateRfpInput } from '../validators/rfpValidator.js';

const RFP_SORT_FIELDS = ['deadlineAt', 'name', 'reference', 'status', 'budget', 'createdAt', 'updatedAt'] as const;

const rfpIncludes = {
  documents: { orderBy: { createdAt: 'asc' } as const },
  customer: { select: { id: true, name: true, logoUrl: true } },
  // Who owns it, so the list can badge the rows that arrived through a share.
  user: { select: { id: true, name: true, email: true } },
};

type RfpRow = Prisma.RfpGetPayload<{ include: typeof rfpIncludes }>;

/**
 * `budget` is a `Decimal(14,2)`, and Prisma hands back a Decimal object that
 * JSON.stringify renders as a string — so the client would receive "12500.00"
 * where it expects a number, and `toLocaleString` on it silently does nothing.
 * Converted once, here, rather than at each of the places that read it.
 */
export function formatRfp(rfp: RfpRow) {
  return { ...rfp, budget: rfp.budget === null ? null : Number(rfp.budget) };
}

export interface RfpQueryParams {
  search?: string;
  status?: string;
  customerId?: string;
  isGoe?: string;
  submissionFormat?: string;
  /** 'open' hides the terminal statuses — the register's default view. */
  scope?: string;
  /** 'shared' or 'owned' — narrows to how the tender reached the caller. */
  ownership?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: string;
  limit?: string;
}

/**
 * A tender may only point at a company the same account owns.
 *
 * `customerId` arrives in the request body and is a plain foreign key into a
 * user-scoped table, so the database would accept another account's id
 * happily — and `rfpIncludes` reads the company back out, which would hand
 * the caller the name and logo of a company they cannot see.
 */
async function assertCustomerOwnedBy(userId: string, customerId?: string | null) {
  if (!customerId) return;
  const customer = await prisma.customer.findFirst({ where: { id: customerId, userId }, select: { id: true } });
  if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Company not found');
}

/**
 * The row the caller may read — theirs, or one shared with them.
 *
 * A 404 rather than a 403 for everything else: whether a tender exists is
 * itself something only the people who can see it should learn.
 */
async function accessibleRfp(userId: string, id: string) {
  const rfp = await prisma.rfp.findFirst({ where: { id, userId }, include: rfpIncludes });
  if (rfp) return rfp;
  if (await canAccessRfp(id, userId)) {
    const shared = await prisma.rfp.findFirst({ where: { id }, include: rfpIncludes });
    if (shared) return shared;
  }
  throw new AppError(404, 'RFP_NOT_FOUND', 'RFP not found');
}

/** The row the caller owns. Sharing onward and deleting are the owner's. */
async function ownedRfp(userId: string, id: string) {
  const rfp = await prisma.rfp.findFirst({ where: { id, userId }, include: rfpIncludes });
  if (!rfp) throw new AppError(404, 'RFP_NOT_FOUND', 'RFP not found');
  return rfp;
}

/** The body as columns: '' means "cleared", absent means "leave alone". */
function writableFields(data: UpdateRfpInput) {
  const out: Prisma.RfpUncheckedUpdateInput = {};
  if (data.name !== undefined) out.name = data.name;
  if (data.reference !== undefined) out.reference = data.reference;
  if (data.deadlineAt !== undefined) out.deadlineAt = new Date(data.deadlineAt);
  if (data.submissionFormat !== undefined) out.submissionFormat = data.submissionFormat;
  if (data.portalUrl !== undefined) out.portalUrl = data.portalUrl || null;
  if (data.customerId !== undefined) out.customerId = data.customerId;
  if (data.isGoe !== undefined) out.isGoe = data.isGoe;
  if (data.budget !== undefined) out.budget = data.budget === null ? null : new Prisma.Decimal(data.budget);
  if (data.status !== undefined) out.status = data.status;
  if (data.notes !== undefined) out.notes = data.notes || null;
  return out;
}

export const rfpService = {
  async findAll(userId: string, query: RfpQueryParams) {
    const pagination = parsePagination(query);

    // Tenders shared with the caller sit alongside their own.
    //
    // The ownership filter lives under `AND` so the search branch below,
    // which assigns `where.OR`, cannot clobber it — the exact shape that
    // leaked every user's mail in `findAllThreads` once.
    const sharedIds = await getSharedRfpIds(userId);
    const ownershipFilter: Prisma.RfpWhereInput =
      sharedIds.length > 0 ? { OR: [{ userId }, { id: { in: sharedIds } }] } : { userId };
    const where: Prisma.RfpWhereInput = { AND: [ownershipFilter] };

    if (query.status) where.status = query.status;
    if (query.submissionFormat) where.submissionFormat = query.submissionFormat;
    if (query.customerId) where.customerId = query.customerId;
    // Narrows the ownership filter above; it can never widen it.
    if (query.ownership === 'shared') where.userId = { not: userId };
    if (query.ownership === 'owned') where.userId = userId;
    if (query.isGoe === 'true') where.isGoe = true;
    if (query.isGoe === 'false') where.isGoe = false;
    // The register accumulates for ever; 'open' is what is still live.
    if (query.scope === 'open') where.status = { notIn: [...RFP_TERMINAL_STATUSES] };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { reference: { contains: query.search, mode: 'insensitive' } },
        { notes: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const requestedSort = query.sortBy || 'deadlineAt';
    const sortBy = (RFP_SORT_FIELDS as readonly string[]).includes(requestedSort) ? requestedSort : 'deadlineAt';
    // Deadlines read soonest-first by default; every other column keeps the
    // descending default the other list pages use.
    const fallbackOrder = sortBy === 'deadlineAt' ? 'asc' : 'desc';
    const sortOrder: Prisma.SortOrder = query.sortOrder === 'asc' ? 'asc' : query.sortOrder === 'desc' ? 'desc' : fallbackOrder;
    // `id` as the tiebreaker, for the same reason every other list has one:
    // without it, rows that tie on the sort column can repeat across pages
    // while others are never reachable.
    const orderBy: Prisma.RfpOrderByWithRelationInput[] = [{ [sortBy]: sortOrder }, { id: 'asc' }];

    const [rfps, total] = await Promise.all([
      prisma.rfp.findMany({ where, orderBy, skip: pagination.skip, take: pagination.limit, include: rfpIncludes }),
      prisma.rfp.count({ where }),
    ]);

    return { data: rfps.map(formatRfp), meta: paginationMeta(total, pagination) };
  },

  async findById(userId: string, id: string) {
    return formatRfp(await accessibleRfp(userId, id));
  },

  async create(userId: string, data: CreateRfpInput) {
    await assertCustomerOwnedBy(userId, data.customerId);
    try {
      const rfp = await prisma.rfp.create({
        data: {
          userId,
          name: data.name,
          reference: data.reference,
          deadlineAt: new Date(data.deadlineAt),
          submissionFormat: data.submissionFormat,
          portalUrl: data.portalUrl || null,
          isGoe: data.isGoe ?? false,
          budget: data.budget === null || data.budget === undefined ? null : new Prisma.Decimal(data.budget),
          status: data.status ?? 'OPEN',
          notes: data.notes || null,
          customerId: data.customerId ?? null,
        },
        include: rfpIncludes,
      });
      auditService.log({ userId, action: 'RFP_CREATED', entityType: 'rfp', entityId: rfp.id, details: { reference: rfp.reference } });
      return formatRfp(rfp);
    } catch (err) {
      // P2002 on (user_id, reference): the buyer's own numbering is how a
      // tender is recognised, so a second row under the same reference is
      // almost always the same tender entered twice.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(409, 'RFP_REFERENCE_TAKEN', `An RFP with reference "${data.reference}" already exists`);
      }
      throw err;
    }
  },

  async update(userId: string, id: string, data: UpdateRfpInput) {
    const existing = await accessibleRfp(userId, id);
    // Against the OWNER, not the caller: a colleague a tender was shared with
    // must not be able to repoint it at a company of their own, which the
    // include would then read back out to the owner.
    await assertCustomerOwnedBy(existing.userId, data.customerId);
    try {
      const rfp = await prisma.rfp.update({ where: { id }, data: writableFields(data), include: rfpIncludes });
      auditService.log({ userId, action: 'RFP_UPDATED', entityType: 'rfp', entityId: id, details: { fields: Object.keys(data) } });
      return formatRfp(rfp);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(409, 'RFP_REFERENCE_TAKEN', `An RFP with reference "${data.reference}" already exists`);
      }
      throw err;
    }
  },

  async remove(userId: string, id: string) {
    const rfp = await ownedRfp(userId, id);
    // Rows go first: the cascade is what makes them unreachable, and a file
    // left behind is waste where a row pointing at a deleted file is a 404
    // the user cannot clear.
    await prisma.rfp.delete({ where: { id } });
    await Promise.all(rfp.documents.map((d) => removeStoredFile(d.storageKey)));
    auditService.log({ userId, action: 'RFP_DELETED', entityType: 'rfp', entityId: id, details: { reference: rfp.reference } });
  },

  async addDocument(
    userId: string,
    rfpId: string,
    file: { filename: string; mimeType: string; size: number; storageKey: string },
    kind: RfpDocumentKind
  ) {
    // Whoever may edit the tender may work on its dossier.
    await accessibleRfp(userId, rfpId);
    const doc = await prisma.rfpDocument.create({
      data: { rfpId, kind, filename: file.filename, mimeType: file.mimeType, size: file.size, storageKey: file.storageKey },
    });
    auditService.log({ userId, action: 'RFP_DOCUMENT_ADDED', entityType: 'rfp', entityId: rfpId, details: { filename: file.filename, kind } });
    return doc;
  },

  /** The document row, checked against the caller — used to serve the bytes. */
  async getDocument(userId: string, rfpId: string, documentId: string) {
    // The access check is on the tender, not the document: a colleague it was
    // shared with must be able to read the dossier, which is the point of
    // sharing a tender at all.
    await accessibleRfp(userId, rfpId);
    const doc = await prisma.rfpDocument.findFirst({ where: { id: documentId, rfpId } });
    if (!doc) throw new AppError(404, 'RFP_DOCUMENT_NOT_FOUND', 'Document not found');
    return doc;
  },

  /**
   * Share a tender with colleagues.
   *
   * The owner's to give: a recipient can read and edit the tender, but not
   * pass it on, because a chain of shares nobody can see is not something
   * the owner agreed to.
   */
  async share(userId: string, rfpId: string, recipientUserIds: string[]) {
    if (!(await isRfpOwner(rfpId, userId))) throw new AppError(404, 'RFP_NOT_FOUND', 'RFP not found');

    // Sharing with yourself is a no-op dressed as an action.
    const validIds = [...new Set(recipientUserIds)].filter((id) => id !== userId);
    if (validIds.length === 0) throw new AppError(400, 'NO_RECIPIENTS', 'Cannot share with yourself');

    const recipients = await prisma.user.findMany({ where: { id: { in: validIds } }, select: { id: true } });
    if (recipients.length !== validIds.length) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    await prisma.rfpShare.createMany({
      data: validIds.map((recipientId) => ({ rfpId, sharedByUserId: userId, sharedWithUserId: recipientId })),
      // Sharing twice is one share, not an error.
      skipDuplicates: true,
    });

    const [sharer, rfp] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
      prisma.rfp.findUnique({ where: { id: rfpId }, select: { name: true, reference: true } }),
    ]);

    const { wsEmitToUsers } = await import('../websocket.js');
    wsEmitToUsers(validIds, 'rfp:shared', {
      rfpId,
      sharedBy: { name: sharer?.name, email: sharer?.email },
      name: rfp?.name,
    });

    auditService.log({ userId, action: 'RFP_SHARED', entityType: 'rfp', entityId: rfpId, details: { sharedWith: validIds } });

    for (const recipientUserId of validIds) {
      await notificationService.create(recipientUserId, {
        type: 'RFP_SHARED',
        title: `RFP shared: ${rfp?.name ?? rfp?.reference ?? ''}`,
        message: 'shared an RFP with you',
        entityType: 'rfp',
        entityId: rfpId,
      });
    }

    return { success: true, sharedWith: validIds.length };
  },

  /** Withdraw a share. Scoped to the sharer, so only they can take it back. */
  async unshare(userId: string, rfpId: string, recipientUserId: string) {
    await prisma.rfpShare.deleteMany({ where: { rfpId, sharedByUserId: userId, sharedWithUserId: recipientUserId } });
    auditService.log({ userId, action: 'RFP_UNSHARED', entityType: 'rfp', entityId: rfpId, details: { recipientUserId } });
    return { success: true };
  },

  async getShares(userId: string, rfpId: string) {
    if (!(await isRfpOwner(rfpId, userId))) throw new AppError(404, 'RFP_NOT_FOUND', 'RFP not found');
    return prisma.rfpShare.findMany({
      where: { rfpId, sharedByUserId: userId },
      include: { sharedWith: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
  },

  async removeDocument(userId: string, rfpId: string, documentId: string) {
    const doc = await this.getDocument(userId, rfpId, documentId);
    await prisma.rfpDocument.delete({ where: { id: documentId } });
    await removeStoredFile(doc.storageKey);
    auditService.log({ userId, action: 'RFP_DOCUMENT_REMOVED', entityType: 'rfp', entityId: rfpId, details: { filename: doc.filename } });
  },
};
