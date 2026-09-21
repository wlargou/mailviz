import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { auditService } from './auditService.js';
import { removeStoredFile } from './rfpStorage.js';
import { RFP_TERMINAL_STATUSES, type RfpDocumentKind } from '../utils/rfp.js';
import type { CreateRfpInput, UpdateRfpInput } from '../validators/rfpValidator.js';

const RFP_SORT_FIELDS = ['deadlineAt', 'name', 'reference', 'status', 'budget', 'createdAt', 'updatedAt'] as const;

const rfpIncludes = {
  documents: { orderBy: { createdAt: 'asc' } as const },
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
  isGoe?: string;
  submissionFormat?: string;
  /** 'open' hides the terminal statuses — the register's default view. */
  scope?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: string;
  limit?: string;
}

/** The row, or a 404 — never another account's row. */
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
  if (data.isGoe !== undefined) out.isGoe = data.isGoe;
  if (data.budget !== undefined) out.budget = data.budget === null ? null : new Prisma.Decimal(data.budget);
  if (data.status !== undefined) out.status = data.status;
  if (data.notes !== undefined) out.notes = data.notes || null;
  return out;
}

export const rfpService = {
  async findAll(userId: string, query: RfpQueryParams) {
    const pagination = parsePagination(query);
    const where: Prisma.RfpWhereInput = { userId };

    if (query.status) where.status = query.status;
    if (query.submissionFormat) where.submissionFormat = query.submissionFormat;
    if (query.isGoe === 'true') where.isGoe = true;
    if (query.isGoe === 'false') where.isGoe = false;
    // The register accumulates for ever; 'open' is what is still live.
    if (query.scope === 'open') where.status = { notIn: [...RFP_TERMINAL_STATUSES] };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { reference: { contains: query.search, mode: 'insensitive' } },
        { notes: { contains: query.search, mode: 'insensitive' } },
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
    return formatRfp(await ownedRfp(userId, id));
  },

  async create(userId: string, data: CreateRfpInput) {
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
    await ownedRfp(userId, id);
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
    await ownedRfp(userId, rfpId);
    const doc = await prisma.rfpDocument.create({
      data: { rfpId, kind, filename: file.filename, mimeType: file.mimeType, size: file.size, storageKey: file.storageKey },
    });
    auditService.log({ userId, action: 'RFP_DOCUMENT_ADDED', entityType: 'rfp', entityId: rfpId, details: { filename: file.filename, kind } });
    return doc;
  },

  /** The document row, checked against the caller — used to serve the bytes. */
  async getDocument(userId: string, rfpId: string, documentId: string) {
    const doc = await prisma.rfpDocument.findFirst({ where: { id: documentId, rfpId, rfp: { userId } } });
    if (!doc) throw new AppError(404, 'RFP_DOCUMENT_NOT_FOUND', 'Document not found');
    return doc;
  },

  async removeDocument(userId: string, rfpId: string, documentId: string) {
    const doc = await this.getDocument(userId, rfpId, documentId);
    await prisma.rfpDocument.delete({ where: { id: documentId } });
    await removeStoredFile(doc.storageKey);
    auditService.log({ userId, action: 'RFP_DOCUMENT_REMOVED', entityType: 'rfp', entityId: rfpId, details: { filename: doc.filename } });
  },
};
