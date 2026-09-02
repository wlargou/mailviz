import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { CreateCustomerInput, UpdateCustomerInput } from '../validators/customerValidator.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { AppError } from '../middleware/errorHandler.js';
import { cleanEmptyStrings } from '../utils/shared.js';
import { domainToCompanyName, getLogoUrl, parseName } from '../utils/domainResolver.js';
import { auditService } from './auditService.js';
import { classifyContactKind } from '../utils/contactKind.js';

interface CustomerQueryParams {
  search?: string;
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;
  categoryId?: string;
}

// Whitelist of sortable Customer columns. `sortBy` comes straight off the query
// string and is used as a Prisma orderBy key, so it must never be trusted raw.
// `emailCount` is absent on purpose — it is not a column, it is the default and
// the fallback, so it is handled by the branch below rather than by this list.
const CUSTOMER_SORT_FIELDS = ['name', 'company', 'email', 'domain', 'isVip', 'createdAt', 'updatedAt'] as const;

export const customerService = {
  async findAll(userId: string, query: CustomerQueryParams) {
    const pagination = parsePagination(query);

    const where: Prisma.CustomerWhereInput = { userId };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { company: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    const requestedSort = query.sortBy || 'emailCount';
    const sortBy = (CUSTOMER_SORT_FIELDS as readonly string[]).includes(requestedSort)
      ? requestedSort
      : 'emailCount';
    const sortOrder: Prisma.SortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const orderBy: Prisma.CustomerOrderByWithRelationInput[] = [
      sortBy === 'emailCount' ? { emails: { _count: sortOrder } } : { [sortBy]: sortOrder },
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

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy,
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          category: true,
          _count: { select: { contacts: true, tasks: true, emails: true } },
        },
      }),
      prisma.customer.count({ where }),
    ]);

    return {
      data: customers,
      meta: paginationMeta(total, pagination),
    };
  },

  async findById(userId: string, id: string) {
    const customer = await prisma.customer.findFirst({
      where: { id, userId },
      include: {
        contacts: { orderBy: { firstName: 'asc' } },
        category: true,
        _count: { select: { contacts: true, tasks: true, emails: true } },
      },
    });
    if (!customer) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    return customer;
  },

  /**
   * A company may only point at a category owned by the same account.
   *
   * `categoryId` arrives in the request body as a plain uuid and is a foreign
   * key into a user-scoped table, so the database accepts another account's id
   * without complaint. The cost is not only a malformed row: both `create` and
   * `update` `include: { category: true }` in what they return, so the response
   * hands the caller the name and colour of a category they have no access to.
   *
   * The same check already guards the equivalent foreign keys on deals
   * (`partnerId`, `customerId`) and tasks (`customerId`, `labelIds`); companies
   * were simply missed.
   */
  async assertCategoryOwnedBy(userId: string, categoryId?: string | null) {
    if (!categoryId) return;
    const category = await prisma.companyCategory.findFirst({
      where: { id: categoryId, userId },
      select: { id: true },
    });
    if (!category) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    }
  },

  async create(userId: string, data: CreateCustomerInput) {
    await this.assertCategoryOwnedBy(userId, data.categoryId);
    const cleaned = cleanEmptyStrings(data);
    let customer;
    try {
      customer = await prisma.customer.create({
        data: { ...cleaned, userId } as any,
        include: { category: true, _count: { select: { contacts: true, tasks: true, emails: true } } },
      });
    } catch (err: any) {
      // `(userId, domain)` is unique. Naming the concept rather than echoing
      // the constraint: under Prisma 7 + the pg adapter `meta.target` is
      // undefined anyway, and what it does carry is raw column names.
      if (err?.code === 'P2002') {
        throw new AppError(409, 'CUSTOMER_EXISTS', 'A company with this domain already exists');
      }
      throw err;
    }
    auditService.log({ userId, action: 'COMPANY_CREATED', entityType: 'company', entityId: customer.id, details: { name: data.name, domain: data.domain } });
    return customer;
  },

  async update(userId: string, id: string, data: UpdateCustomerInput) {
    const existing = await prisma.customer.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    await this.assertCategoryOwnedBy(userId, data.categoryId);
    const cleaned = cleanEmptyStrings(data);
    let customer;
    try {
      customer = await prisma.customer.update({
        where: { id, userId },
        data: cleaned,
        include: { category: true, _count: { select: { contacts: true, tasks: true, emails: true } } },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new AppError(409, 'CUSTOMER_EXISTS', 'A company with this domain already exists');
      }
      throw err;
    }
    auditService.log({ userId, action: 'COMPANY_UPDATED', entityType: 'company', entityId: id, details: { changes: Object.keys(data) } });
    return customer;
  },

  async delete(userId: string, id: string) {
    const existing = await prisma.customer.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    await prisma.customer.delete({ where: { id } });
    auditService.log({ userId, action: 'COMPANY_DELETED', entityType: 'company', entityId: id, details: { name: existing.name } });
    return { success: true };
  },

  async findOrCreateByDomain(userId: string, domain: string) {
    const existing = await prisma.customer.findUnique({
      where: { userId_domain: { userId, domain } },
    });
    if (existing) return { customer: existing, created: false };

    const name = domainToCompanyName(domain);
    const customer = await prisma.customer.create({
      data: {
        name,
        company: name,
        domain,
        website: `https://${domain}`,
        logoUrl: getLogoUrl(domain),
        userId,
      },
    });
    return { customer, created: true };
  },

  /**
   * The contact for a sender address, created if this is the first time it has
   * been seen.
   *
   * Matching has to consider merge aliases, not just the primary address.
   * `contactMergeService.merge` moves every address a discarded row answered to
   * into `contact_email_aliases` and deletes that row — so a lookup on `email`
   * alone finds nothing the next time that address writes, and helpfully
   * recreates the duplicate the user just merged away. The merge survived
   * exactly until the next sync tick, silently.
   *
   * Two queries rather than one OR, because this runs per address per message
   * — three or four times for every mail in a 131k-message mailbox. The exact
   * match is an index hit and answers almost every call; only a miss pays for
   * the alias lookup (also indexed) and the case-insensitive comparison, which
   * cannot use the btree on `email` and would otherwise scan the whole table on
   * every address of every message.
   *
   * Scoped by `userId` and not by `customerId`: a merged contact may now live
   * under a different company than the one this address's domain resolves to,
   * and finding it there is the point. Ownership is what must never be dropped.
   */
  async findOrCreateContact(userId: string, email: string, displayName: string | null, customerId: string) {
    const exact = await prisma.contact.findFirst({
      where: { email, customer: { userId } },
    });
    if (exact) return { contact: exact, created: false };

    // Aliases are stored trimmed and lowercased by the merge.
    const normalized = email.trim().toLowerCase();
    const merged = await prisma.contact.findFirst({
      where: {
        AND: [
          { customer: { userId } },
          {
            OR: [
              { emailAliases: { some: { email: normalized } } },
              // Also catches the plain case variant, which would otherwise be
              // a second row for the same person.
              { email: { equals: normalized, mode: 'insensitive' } },
            ],
          },
        ],
      },
    });
    if (merged) return { contact: merged, created: false };

    const { firstName, lastName } = parseName(displayName, email);
    // Classified once, at creation. The inputs (address and display name) do not
    // change afterwards, so re-deriving it on every read would be work for the
    // same answer — and storing it is what lets the list filter and index on it.
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true },
    });
    const kind = classifyContactKind({
      email,
      firstName,
      lastName,
      companyName: customer?.name ?? null,
    });
    const contact = await prisma.contact.create({
      data: { firstName, lastName, email, customerId, kind },
    });
    return { contact, created: true };
  },

  async findAttachments(userId: string, customerId: string) {
    return prisma.emailAttachment.findMany({
      where: { email: { customerId, customer: { userId } } },
      include: {
        email: {
          select: { id: true, subject: true, from: true, fromName: true, receivedAt: true, customerId: true },
        },
      },
      orderBy: { email: { receivedAt: 'desc' } },
    });
  },

  async findLinkedEvents(userId: string, customerId: string) {
    const links = await prisma.calendarEventCustomer.findMany({
      where: { customerId, customer: { userId } },
      include: { calendarEvent: true },
      orderBy: { calendarEvent: { startTime: 'desc' } },
    });
    return links.map((l) => l.calendarEvent);
  },
};
