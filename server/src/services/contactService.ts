import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CreateContactInput, UpdateContactInput } from '../validators/contactValidator.js';
import { AppError } from '../middleware/errorHandler.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { cleanEmptyStrings } from '../utils/shared.js';

interface ContactQueryParams {
  search?: string;
  customerId?: string;
  page?: string;
  limit?: string;
}

export const contactService = {
  async findAll(userId: string, query: ContactQueryParams) {
    const pagination = parsePagination(query);

    const where: Prisma.ContactWhereInput = { customer: { userId } };
    if (query.customerId) {
      where.customerId = query.customerId;
    }
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { role: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const sortBy = query.sortBy || 'emailCount';

    // For emailCount sort, we need a raw approach since there's no direct relation
    if (sortBy === 'emailCount') {
      // Get contacts with email counts via raw SQL subquery
      const [contacts, total] = await Promise.all([
        prisma.contact.findMany({
          where,
          skip: pagination.skip,
          take: pagination.limit,
          include: {
            customer: { select: { id: true, name: true, domain: true, logoUrl: true } },
          },
        }),
        prisma.contact.count({ where }),
      ]);

      // Batch count emails for each contact by their email address
      const contactEmails = contacts.filter(c => c.email).map(c => c.email!);
      let emailCounts: Record<string, number> = {};
      if (contactEmails.length > 0) {
        const counts = await prisma.email.groupBy({
          by: ['from'],
          where: { from: { in: contactEmails }, userId },
          _count: { _all: true },
        });
        emailCounts = Object.fromEntries(counts.map(c => [c.from, c._count._all]));
      }

      const contactsWithCount = contacts.map(c => ({
        ...c,
        _emailCount: c.email ? (emailCounts[c.email] || 0) : 0,
      }));

      // Sort by email count desc
      contactsWithCount.sort((a, b) => b._emailCount - a._emailCount);

      return {
        data: contactsWithCount,
        meta: paginationMeta(total, pagination),
      };
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { [sortBy]: (query.sortOrder || 'asc') as Prisma.SortOrder },
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          customer: { select: { id: true, name: true, domain: true, logoUrl: true } },
        },
      }),
      prisma.contact.count({ where }),
    ]);

    return {
      data: contacts.map(c => ({ ...c, _emailCount: 0 })),
      meta: paginationMeta(total, pagination),
    };
  },

  async findById(userId: string, id: string) {
    const contact = await prisma.contact.findFirst({
      where: { id, customer: { userId } },
      include: {
        customer: { select: { id: true, name: true, domain: true, logoUrl: true, company: true, website: true } },
      },
    });
    if (!contact) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    return contact;
  },

  async findContactEvents(userId: string, id: string) {
    const contact = await prisma.contact.findFirst({
      where: { id, customer: { userId } },
    });
    if (!contact) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    if (!contact.email) return [];

    // Find events where this contact's email appears in the JSON attendees array
    const events = await prisma.calendarEvent.findMany({
      where: {
        userId,
        attendees: {
          path: [],
          array_contains: [{ email: contact.email }],
        },
      },
      orderBy: { startTime: 'desc' },
      take: 50,
    });

    // Fallback: if JSON path query doesn't work, filter via customer's events
    if (events.length === 0) {
      const customerEvents = await prisma.calendarEventCustomer.findMany({
        where: { customerId: contact.customerId, customer: { userId } },
        include: { calendarEvent: true },
        orderBy: { calendarEvent: { startTime: 'desc' } },
        take: 50,
      });

      // Filter to events where the contact's email is in attendees
      return customerEvents
        .map((ce) => ce.calendarEvent)
        .filter((evt) => {
          const attendees = evt.attendees as unknown as Array<{ email: string }> | null;
          return attendees?.some((a) => a.email === contact.email);
        });
    }

    return events;
  },

  async findAttachments(userId: string, id: string) {
    const contact = await prisma.contact.findFirst({
      where: { id, customer: { userId } },
    });
    if (!contact) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    if (!contact.email) return [];

    return prisma.emailAttachment.findMany({
      where: {
        email: {
          userId,
          OR: [
            { from: contact.email },
            { to: { has: contact.email } },
            { cc: { has: contact.email } },
          ],
        },
      },
      include: {
        email: {
          select: { id: true, subject: true, from: true, fromName: true, receivedAt: true, customerId: true },
        },
      },
      orderBy: { email: { receivedAt: 'desc' } },
    });
  },

  async findByCustomerId(userId: string, customerId: string) {
    return prisma.contact.findMany({
      where: { customerId, customer: { userId } },
      orderBy: { firstName: 'asc' },
    });
  },

  async create(userId: string, data: CreateContactInput) {
    // Verify customer exists and belongs to user
    const customer = await prisma.customer.findFirst({
      where: { id: data.customerId, userId },
    });
    if (!customer) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    const cleaned = cleanEmptyStrings(data);
    return prisma.contact.create({ data: cleaned as any });
  },

  async update(userId: string, id: string, data: UpdateContactInput) {
    const existing = await prisma.contact.findFirst({
      where: { id, customer: { userId } },
    });
    if (!existing) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    const cleaned = cleanEmptyStrings(data);
    return prisma.contact.update({ where: { id }, data: cleaned });
  },

  async delete(userId: string, id: string) {
    const existing = await prisma.contact.findFirst({
      where: { id, customer: { userId } },
    });
    if (!existing) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    await prisma.contact.delete({ where: { id } });
    return { success: true };
  },
};
