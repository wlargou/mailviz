import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { likePattern, queryWords } from '../utils/searchTerms.js';
import { auditService } from './auditService.js';
import { promoteSenders } from './accountStatus.js';
import { removeStoredFile } from './rfpStorage.js';
import {
  REFERENCE_APPRECIATIONS,
  REFERENCE_DOCUMENT_TYPES,
  REFERENCE_WORK_STATUSES,
  amountHtOf,
  effectiveDateOf,
  endOfPeriod,
  formatPartialDate,
  parsePartialDate,
} from '../utils/clientReference.js';
import {
  PRESTATION_TAG_NAMES,
  TECHNOLOGY_TAG_NAMES,
  canonicalPartners,
  prestationTagsFor,
  technologyTagsFor,
} from '../utils/referenceTaxonomy.js';
import type { CreateClientReferenceInput, UpdateClientReferenceInput } from '../validators/clientReferenceValidator.js';

/**
 * The client references register: customers' attestations of projects PowerM
 * delivered, searchable the way a bid team asks — "Power references above a
 * million, in the last three years".
 *
 * Four columns are derived here on every write and written nowhere else:
 * `amountHt`, `effectiveDate`, `technologyTags` and `prestationTags`. They
 * are what the filters compare on; `derive` is the one place they come from.
 */

const includes = {
  customer: { select: { id: true, name: true, logoUrl: true, domain: true } },
  signatories: { orderBy: { position: 'asc' } as const, select: { id: true, name: true, role: true } },
};

type Row = Prisma.ClientReferenceGetPayload<{ include: typeof includes }>;

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * The row as the API serves it: dates at the precision the letter gave them
 * ("2025", "2025-07", "2025-07-30"), Decimals as numbers, and the storage key
 * kept to the server — it is a path on the volume, not something to hand out.
 */
export function formatReference(row: Row) {
  const {
    projectStart,
    projectStartPrecision,
    projectEnd,
    projectEndPrecision,
    documentStorageKey,
    amount,
    amountHt,
    signedAt,
    effectiveDate,
    ...rest
  } = row;
  return {
    ...rest,
    amount: num(amount),
    amountHt: num(amountHt),
    projectStart: formatPartialDate(projectStart, projectStartPrecision),
    projectEnd: formatPartialDate(projectEnd, projectEndPrecision),
    signedAt: isoDay(signedAt),
    effectiveDate: isoDay(effectiveDate),
    hasDocument: Boolean(documentStorageKey),
  };
}

export type ClientReferenceDto = ReturnType<typeof formatReference>;

export interface ClientReferenceQuery {
  search?: string;
  /** Technology tags, comma-separated: a reference with ANY of them matches. */
  tags?: string;
  /** Service tags, comma-separated, ANY. */
  services?: string;
  partner?: string;
  customerId?: string;
  /** Compared on `amountHt` — see the schema. */
  minAmount?: string;
  maxAmount?: string;
  /** "In the last N years", measured on `effectiveDate`. */
  sinceYears?: string;
  /** One appreciation, or POSITIVE for satisfaction or good execution. */
  appreciation?: string;
  /** 'true': at least one signatory's role is stated. */
  signerRole?: string;
  documentType?: string;
  workStatus?: string;
  needsReview?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: string;
  limit?: string;
}

const SORT_FIELDS = ['amountHt', 'effectiveDate', 'signedAt', 'customerName', 'projectName', 'createdAt', 'updatedAt'] as const;

const listOf = (csv?: string) =>
  (csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function finite(raw?: string): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The ids whose text matches every typed word, without regard to case or
 * accents — "securite" finds "Sécurité". Folded by the same SQL functions as
 * mail search, on both sides. Unindexed: a register is a few hundred rows a
 * user, and the text spans the signatories and the company too.
 */
async function searchMatches(userId: string, search: string): Promise<string[] | null> {
  const words = queryWords(search);
  if (words.length === 0) return null;
  const conditions = words.map((w) => Prisma.sql`public.mv_search_fold(t.doc) LIKE public.mv_search_fold(${likePattern(w)})`);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT r.id
    FROM client_references r
    LEFT JOIN customers c ON c.id = r.customer_id
    CROSS JOIN LATERAL (
      SELECT concat_ws(' ',
        r.customer_name, c.name, r.city, r.project_name, r.project_reference, r.attestation_number,
        r.amount_scope, r.appreciation_quote, r.signed_place, r.details,
        array_to_string(r.technologies, ' '), array_to_string(r.technology_tags, ' '),
        array_to_string(r.prestations, ' '), array_to_string(r.prestation_tags, ' '),
        array_to_string(r.partners, ' '), array_to_string(r.consortium_partners, ' '),
        (SELECT string_agg(concat_ws(' ', s.name, s.role), ' ') FROM client_reference_signatories s WHERE s.reference_id = r.id)
      ) AS doc
    ) t
    WHERE r.user_id = ${userId} AND ${Prisma.join(conditions, ' AND ')}
  `;
  return rows.map((r) => r.id);
}

/**
 * The where-clause for a query. Every condition goes under `AND` with the
 * ownership filter first, so no branch can replace it — the shape that leaked
 * every user's deals once (`dealService.test.ts`).
 */
async function whereFor(userId: string, query: ClientReferenceQuery, now: Date): Promise<Prisma.ClientReferenceWhereInput> {
  const and: Prisma.ClientReferenceWhereInput[] = [{ userId }];

  if (query.search?.trim()) {
    const ids = await searchMatches(userId, query.search);
    if (ids) and.push({ id: { in: ids } });
  }
  const tags = listOf(query.tags);
  if (tags.length) and.push({ technologyTags: { hasSome: tags } });
  const services = listOf(query.services);
  if (services.length) and.push({ prestationTags: { hasSome: services } });
  if (query.partner) and.push({ partners: { has: query.partner } });
  if (query.customerId) and.push({ customerId: query.customerId });

  const min = finite(query.minAmount);
  if (min !== null) and.push({ amountHt: { gte: min } });
  const max = finite(query.maxAmount);
  if (max !== null) and.push({ amountHt: { lte: max } });

  const years = finite(query.sinceYears);
  if (years !== null && years > 0) {
    const since = new Date(Date.UTC(now.getUTCFullYear() - Math.floor(years), now.getUTCMonth(), now.getUTCDate()));
    and.push({ effectiveDate: { gte: since } });
  }

  if (query.appreciation === 'POSITIVE') and.push({ appreciation: { in: ['SATISFACTION', 'GOOD_EXECUTION'] } });
  else if ((REFERENCE_APPRECIATIONS as readonly string[]).includes(query.appreciation ?? '')) and.push({ appreciation: query.appreciation });

  if (query.signerRole === 'true') and.push({ signatories: { some: { role: { not: null } } } });
  if ((REFERENCE_DOCUMENT_TYPES as readonly string[]).includes(query.documentType ?? '')) and.push({ documentType: query.documentType });
  if ((REFERENCE_WORK_STATUSES as readonly string[]).includes(query.workStatus ?? '')) and.push({ workStatus: query.workStatus });
  if (query.needsReview === 'true') and.push({ needsReview: true });
  if (query.needsReview === 'false') and.push({ needsReview: false });

  return { AND: and };
}

function orderFor(query: ClientReferenceQuery): Prisma.ClientReferenceOrderByWithRelationInput[] {
  const requested = query.sortBy || 'amountHt';
  const sortBy = (SORT_FIELDS as readonly string[]).includes(requested) ? requested : 'amountHt';
  const textual = sortBy === 'customerName' || sortBy === 'projectName';
  const fallback = textual ? 'asc' : 'desc';
  const sort: Prisma.SortOrder = query.sortOrder === 'asc' ? 'asc' : query.sortOrder === 'desc' ? 'desc' : fallback;
  // Nulls last either way: a reference with no amount or no date is not the
  // biggest or the latest, and must not head the list when sorting by it.
  const nullable = sortBy !== 'customerName' && sortBy !== 'createdAt' && sortBy !== 'updatedAt';
  const primary = nullable ? { [sortBy]: { sort, nulls: 'last' } } : { [sortBy]: sort };
  // `id` breaks ties, so a page boundary never repeats or skips a row.
  return [primary as Prisma.ClientReferenceOrderByWithRelationInput, { id: 'asc' }];
}

async function assertCustomerOwnedBy(userId: string, customerId?: string | null) {
  if (!customerId) return;
  const customer = await prisma.customer.findFirst({ where: { id: customerId, userId }, select: { id: true } });
  if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Company not found');
}

async function ownedRow(userId: string, id: string) {
  const row = await prisma.clientReference.findFirst({ where: { id, userId }, include: includes });
  if (!row) throw new AppError(404, 'REFERENCE_NOT_FOUND', 'Reference not found');
  return row;
}

/** The fields a write can set, before the derived ones are added. */
interface Fields {
  projectName: string | null;
  amount: number | null;
  amountType: string | null;
  projectStart: Date | null;
  projectStartPrecision: string | null;
  projectEnd: Date | null;
  projectEndPrecision: string | null;
  signedAt: Date | null;
  technologies: string[];
  prestations: string[];
}

/** The four derived columns — computed here, written nowhere else. */
function derive(f: Fields) {
  return {
    amountHt: amountHtOf(f.amount, f.amountType),
    effectiveDate: effectiveDateOf(f),
    technologyTags: technologyTagsFor(f.technologies, f.projectName),
    prestationTags: prestationTagsFor(f.prestations),
  };
}

/** A project cannot end before it starts — compared period to period. */
function assertPeriodOrder(f: Fields) {
  if (f.projectStart && f.projectEnd && endOfPeriod(f.projectEnd, f.projectEndPrecision) < f.projectStart) {
    throw new AppError(400, 'PROJECT_END_BEFORE_START', 'The project cannot end before it starts');
  }
}

function partialDateColumns(value: string | null | undefined, key: 'projectStart' | 'projectEnd') {
  if (value === undefined) return {};
  const parsed = value ? parsePartialDate(value) : null;
  return { [key]: parsed?.date ?? null, [`${key}Precision`]: parsed?.precision ?? null };
}

/** The body as columns: absent leaves a field alone, null clears it. */
function columnsOf(data: UpdateClientReferenceInput): Prisma.ClientReferenceUncheckedUpdateInput {
  const out: Prisma.ClientReferenceUncheckedUpdateInput = {};
  const copy = [
    'documentType',
    'workStatus',
    'customerName',
    'customerId',
    'city',
    'projectName',
    'projectReference',
    'attestationNumber',
    'amount',
    'currency',
    'amountType',
    'amountScope',
    'appreciation',
    'appreciationQuote',
    'signedPlace',
    'technologies',
    'prestations',
    'consortiumPartners',
    'details',
    'needsReview',
    'reviewNotes',
  ] as const;
  for (const key of copy) {
    if (data[key] !== undefined) (out as Record<string, unknown>)[key] = data[key];
  }
  if (data.partners !== undefined) out.partners = canonicalPartners(data.partners);
  if (data.signedAt !== undefined) out.signedAt = data.signedAt ? parsePartialDate(data.signedAt)!.date : null;
  Object.assign(out, partialDateColumns(data.projectStart, 'projectStart'), partialDateColumns(data.projectEnd, 'projectEnd'));
  return out;
}

function signatoryRows(signatories: NonNullable<CreateClientReferenceInput['signatories']>) {
  return signatories.map((s, position) => ({ name: s.name ?? null, role: s.role ?? null, position }));
}

/** Counted in JS: a register is a few hundred rows, and four facets read them all. */
function countValues(rows: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const values of rows) for (const v of new Set(values)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

export const clientReferenceService = {
  async findAll(userId: string, query: ClientReferenceQuery, now = new Date()) {
    const pagination = parsePagination(query);
    const where = await whereFor(userId, query, now);
    const [rows, total] = await Promise.all([
      prisma.clientReference.findMany({ where, orderBy: orderFor(query), skip: pagination.skip, take: pagination.limit, include: includes }),
      prisma.clientReference.count({ where }),
    ]);
    return { data: rows.map(formatReference), meta: paginationMeta(total, pagination) };
  },

  /**
   * Every id the query matches, in the list's order — what the detail page
   * steps through with Previous and Next. Capped: past a thousand, stepping
   * one by one is not how anyone reads a register.
   */
  async ids(userId: string, query: ClientReferenceQuery, now = new Date()) {
    const where = await whereFor(userId, query, now);
    const rows = await prisma.clientReference.findMany({ where, orderBy: orderFor(query), select: { id: true }, take: 1000 });
    return rows.map((r) => r.id);
  },

  /**
   * What the filters offer: the tags in the taxonomy's order with how many
   * references carry each, the partners and companies that occur, and the
   * review backlog.
   */
  async facets(userId: string) {
    const rows = await prisma.clientReference.findMany({
      where: { userId },
      select: { technologyTags: true, prestationTags: true, partners: true, needsReview: true, customer: { select: { id: true, name: true } } },
    });
    const tech = countValues(rows.map((r) => r.technologyTags));
    const services = countValues(rows.map((r) => r.prestationTags));
    const partners = countValues(rows.map((r) => r.partners));
    const companies = new Map<string, { id: string; name: string; count: number }>();
    for (const r of rows) {
      if (!r.customer) continue;
      const c = companies.get(r.customer.id) ?? { ...r.customer, count: 0 };
      c.count += 1;
      companies.set(r.customer.id, c);
    }
    return {
      total: rows.length,
      needsReview: rows.filter((r) => r.needsReview).length,
      technologyTags: TECHNOLOGY_TAG_NAMES.map((tag) => ({ tag, count: tech.get(tag) ?? 0 })),
      prestationTags: PRESTATION_TAG_NAMES.map((tag) => ({ tag, count: services.get(tag) ?? 0 })),
      partners: [...partners.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      companies: [...companies.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  },

  async findById(userId: string, id: string) {
    return formatReference(await ownedRow(userId, id));
  },

  /** `importKey` is the import script's: a re-run finds the row it made. */
  async create(userId: string, data: CreateClientReferenceInput, options: { importKey?: string } = {}) {
    await assertCustomerOwnedBy(userId, data.customerId);
    const columns = columnsOf(data) as Prisma.ClientReferenceUncheckedCreateInput;
    const fields: Fields = {
      projectName: data.projectName ?? null,
      amount: data.amount ?? null,
      amountType: data.amountType ?? null,
      projectStart: (columns.projectStart as Date | null | undefined) ?? null,
      projectStartPrecision: (columns.projectStartPrecision as string | null | undefined) ?? null,
      projectEnd: (columns.projectEnd as Date | null | undefined) ?? null,
      projectEndPrecision: (columns.projectEndPrecision as string | null | undefined) ?? null,
      signedAt: (columns.signedAt as Date | null | undefined) ?? null,
      technologies: data.technologies ?? [],
      prestations: data.prestations ?? [],
    };
    assertPeriodOrder(fields);
    const row = await prisma.clientReference.create({
      data: {
        ...columns,
        ...derive(fields),
        userId,
        customerName: data.customerName,
        importKey: options.importKey ?? null,
        signatories: data.signatories?.length ? { create: signatoryRows(data.signatories) } : undefined,
      },
      include: includes,
    });
    auditService.log({ userId, action: 'REFERENCE_CREATED', entityType: 'client_reference', entityId: row.id, details: { customerName: row.customerName } });
    if (row.customerId) await promoteSenders(userId, [row.customerId]);
    return formatReference(row);
  },

  async update(userId: string, id: string, data: UpdateClientReferenceInput) {
    const existing = await ownedRow(userId, id);
    await assertCustomerOwnedBy(userId, data.customerId);
    const columns = columnsOf(data);
    const pick = <K extends keyof Fields>(key: K): Fields[K] =>
      (key in columns ? (columns as Record<string, unknown>)[key] : existing[key as keyof Row]) as Fields[K];
    const fields: Fields = {
      projectName: pick('projectName'),
      amount: 'amount' in columns ? (columns.amount as number | null) : num(existing.amount),
      amountType: pick('amountType'),
      projectStart: pick('projectStart'),
      projectStartPrecision: pick('projectStartPrecision'),
      projectEnd: pick('projectEnd'),
      projectEndPrecision: pick('projectEndPrecision'),
      signedAt: pick('signedAt'),
      technologies: pick('technologies'),
      prestations: pick('prestations'),
    };
    assertPeriodOrder(fields);
    const row = await prisma.$transaction(async (tx) => {
      // The list replaces the old one: the form sends the signatories it shows.
      if (data.signatories !== undefined) {
        await tx.clientReferenceSignatory.deleteMany({ where: { referenceId: id } });
        if (data.signatories.length) {
          await tx.clientReferenceSignatory.createMany({ data: signatoryRows(data.signatories).map((s) => ({ ...s, referenceId: id })) });
        }
      }
      return tx.clientReference.update({ where: { id }, data: { ...columns, ...derive(fields) }, include: includes });
    });
    auditService.log({ userId, action: 'REFERENCE_UPDATED', entityType: 'client_reference', entityId: id, details: { fields: Object.keys(data) } });
    if (row.customerId && row.customerId !== existing.customerId) await promoteSenders(userId, [row.customerId]);
    return formatReference(row);
  },

  async remove(userId: string, id: string) {
    const row = await ownedRow(userId, id);
    // The row first: a file left behind is waste, a row pointing at a deleted
    // file is a 410 nobody can clear.
    await prisma.clientReference.delete({ where: { id } });
    if (row.documentStorageKey) await removeStoredFile(row.documentStorageKey);
    auditService.log({ userId, action: 'REFERENCE_DELETED', entityType: 'client_reference', entityId: id, details: { customerName: row.customerName } });
  },

  /**
   * Point the reference at a file multer has already written. The old file is
   * removed once the row no longer names it; when the reference is not the
   * caller's, the new file is removed instead, so a refused upload leaves
   * nothing on the volume.
   */
  async replaceDocument(userId: string, id: string, file: { filename: string; mimeType: string; size: number; storageKey: string }) {
    let row: Row;
    try {
      row = await ownedRow(userId, id);
    } catch (err) {
      await removeStoredFile(file.storageKey);
      throw err;
    }
    const updated = await prisma.clientReference.update({
      where: { id },
      data: {
        documentStorageKey: file.storageKey,
        documentFilename: file.filename,
        documentMimeType: file.mimeType,
        documentSize: file.size,
        documentUploadedAt: new Date(),
      },
      include: includes,
    });
    if (row.documentStorageKey && row.documentStorageKey !== file.storageKey) await removeStoredFile(row.documentStorageKey);
    auditService.log({ userId, action: 'REFERENCE_DOCUMENT_REPLACED', entityType: 'client_reference', entityId: id, details: { filename: file.filename } });
    return formatReference(updated);
  },

  /** Where the file is, for the caller's own reference only. */
  async getDocument(userId: string, id: string) {
    const row = await ownedRow(userId, id);
    if (!row.documentStorageKey) throw new AppError(404, 'REFERENCE_DOCUMENT_NOT_FOUND', 'This reference has no document');
    return {
      storageKey: row.documentStorageKey,
      filename: row.documentFilename ?? 'reference.pdf',
      mimeType: row.documentMimeType ?? 'application/pdf',
    };
  },
};
