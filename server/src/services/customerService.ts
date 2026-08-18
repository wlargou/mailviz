import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CreateCustomerInput, UpdateCustomerInput } from '../validators/customerValidator.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { AppError } from '../middleware/errorHandler.js';
import { cleanEmptyStrings } from '../utils/shared.js';
import { domainToCompanyName, getLogoUrl, parseName } from '../utils/domainResolver.js';
import { auditService } from './auditService.js';

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

  async create(userId: string, data: CreateCustomerInput) {
    const cleaned = cleanEmptyStrings(data);
    const customer = await prisma.customer.create({
      data: { ...cleaned, userId } as any,
      include: { category: true, _count: { select: { contacts: true, tasks: true, emails: true } } },
    });
    auditService.log({ userId, action: 'COMPANY_CREATED', entityType: 'company', entityId: customer.id, details: { name: data.name, domain: data.domain } });
    return customer;
  },

  async update(userId: string, id: string, data: UpdateCustomerInput) {
    const existing = await prisma.customer.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    const cleaned = cleanEmptyStrings(data);
    const customer = await prisma.customer.update({
      where: { id },
      data: cleaned,
      include: { category: true, _count: { select: { contacts: true, tasks: true, emails: true } } },
    });
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

  async findOrCreateContact(userId: string, email: string, displayName: string | null, customerId: string) {
    const existing = await prisma.contact.findFirst({
      where: { email, customer: { userId } },
    });
    if (existing) return { contact: existing, created: false };

    const { firstName, lastName } = parseName(displayName, email);
    const contact = await prisma.contact.create({
      data: { firstName, lastName, email, customerId },
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
