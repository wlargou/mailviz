import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CreateCustomerInput, UpdateCustomerInput } from '../validators/customerValidator.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { AppError } from '../middleware/errorHandler.js';
import { domainToCompanyName, getLogoUrl, parseName } from '../utils/domainResolver.js';

interface CustomerQueryParams {
  search?: string;
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;
  categoryId?: string;
}

export const customerService = {
  async findAll(query: CustomerQueryParams) {
    const pagination = parsePagination(query);

    const where: Prisma.CustomerWhereInput = {};
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

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = (query.sortOrder || 'desc') as Prisma.SortOrder;

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
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

  async findById(id: string) {
    const customer = await prisma.customer.findUnique({
      where: { id },
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

  async create(data: CreateCustomerInput) {
    const cleaned = cleanEmptyStrings(data);
    return prisma.customer.create({
      data: cleaned as any,
      include: { category: true, _count: { select: { contacts: true, tasks: true, emails: true } } },
    });
  },

  async update(id: string, data: UpdateCustomerInput) {
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    const cleaned = cleanEmptyStrings(data);
    return prisma.customer.update({
      where: { id },
      data: cleaned,
      include: { category: true, _count: { select: { contacts: true, tasks: true, emails: true } } },
    });
  },

  async delete(id: string) {
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    await prisma.customer.delete({ where: { id } });
    return { success: true };
  },

  async findOrCreateByDomain(domain: string) {
    const existing = await prisma.customer.findUnique({ where: { domain } });
    if (existing) return { customer: existing, created: false };

    const name = domainToCompanyName(domain);
    const customer = await prisma.customer.create({
      data: {
        name,
        company: name,
        domain,
        website: `https://${domain}`,
        logoUrl: getLogoUrl(domain),
      },
    });
    return { customer, created: true };
  },

  async findOrCreateContact(email: string, displayName: string | null, customerId: string) {
    const existing = await prisma.contact.findFirst({ where: { email } });
    if (existing) return { contact: existing, created: false };

    const { firstName, lastName } = parseName(displayName, email);
    const contact = await prisma.contact.create({
      data: { firstName, lastName, email, customerId },
    });
    return { contact, created: true };
  },

  async findAttachments(customerId: string) {
    return prisma.emailAttachment.findMany({
      where: { email: { customerId } },
      include: {
        email: {
          select: { id: true, subject: true, from: true, fromName: true, receivedAt: true, customerId: true },
        },
      },
      orderBy: { email: { receivedAt: 'desc' } },
    });
  },

  async findLinkedEvents(customerId: string) {
    const links = await prisma.calendarEventCustomer.findMany({
      where: { customerId },
      include: { calendarEvent: true },
      orderBy: { calendarEvent: { startTime: 'desc' } },
    });
    return links.map((l) => l.calendarEvent);
  },
};

function cleanEmptyStrings(data: Record<string, any>) {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    cleaned[key] = value === '' ? null : value;
  }
  return cleaned;
}
