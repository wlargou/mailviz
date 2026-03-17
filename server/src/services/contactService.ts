import { PrismaClient, Prisma } from '@prisma/client';
import { CreateContactInput, UpdateContactInput } from '../validators/contactValidator.js';
import { AppError } from '../middleware/errorHandler.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';

const prisma = new PrismaClient();

interface ContactQueryParams {
  search?: string;
  customerId?: string;
  page?: string;
  limit?: string;
}

export const contactService = {
  async findAll(query: ContactQueryParams) {
    const pagination = parsePagination(query);

    const where: Prisma.ContactWhereInput = {};
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

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { firstName: 'asc' },
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          customer: { select: { id: true, name: true, domain: true, logoUrl: true } },
        },
      }),
      prisma.contact.count({ where }),
    ]);

    return {
      data: contacts,
      meta: paginationMeta(total, pagination),
    };
  },

  async findById(id: string) {
    const contact = await prisma.contact.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, domain: true, logoUrl: true, company: true, website: true } },
      },
    });
    if (!contact) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    return contact;
  },

  async findContactEvents(id: string) {
    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    if (!contact.email) return [];

    // Find events where this contact's email appears in the JSON attendees array
    const events = await prisma.calendarEvent.findMany({
      where: {
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
        where: { customerId: contact.customerId },
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

  async findAttachments(id: string) {
    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    if (!contact.email) return [];

    return prisma.emailAttachment.findMany({
      where: {
        email: {
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

  async findByCustomerId(customerId: string) {
    return prisma.contact.findMany({
      where: { customerId },
      orderBy: { firstName: 'asc' },
    });
  },

  async create(data: CreateContactInput) {
    // Verify customer exists
    const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    const cleaned = cleanEmptyStrings(data);
    return prisma.contact.create({ data: cleaned as any });
  },

  async update(id: string, data: UpdateContactInput) {
    const existing = await prisma.contact.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    const cleaned = cleanEmptyStrings(data);
    return prisma.contact.update({ where: { id }, data: cleaned });
  },

  async delete(id: string) {
    const existing = await prisma.contact.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    await prisma.contact.delete({ where: { id } });
    return { success: true };
  },
};

function cleanEmptyStrings(data: Record<string, any>) {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    cleaned[key] = value === '' ? null : value;
  }
  return cleaned;
}
