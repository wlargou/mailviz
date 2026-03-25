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

    const sortBy = query.sortBy || 'emailCount';
    const sortOrder = (query.sortOrder || 'desc') as Prisma.SortOrder;

    const orderBy = sortBy === 'emailCount'
      ? { emails: { _count: sortOrder } }
      : { [sortBy]: sortOrder };

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
