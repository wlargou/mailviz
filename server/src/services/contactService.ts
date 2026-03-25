import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CreateContactInput, UpdateContactInput } from '../validators/contactValidator.js';
import { AppError } from '../middleware/errorHandler.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { cleanEmptyStrings } from '../utils/shared.js';
import { auditService } from './auditService.js';

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
    const sortOrder = (query.sortOrder || 'desc') as Prisma.SortOrder;

    if (sortBy === 'emailCount') {
      // Use raw SQL to sort by email count across all pages
      // Build WHERE clause parts
      const whereParts: string[] = [`cu.user_id = '${userId}'`];
      if (query.customerId) {
        whereParts.push(`c.customer_id = '${query.customerId}'`);
      }
      if (query.search) {
        const s = query.search.replace(/'/g, "''");
        whereParts.push(`(c.first_name ILIKE '%${s}%' OR c.last_name ILIKE '%${s}%' OR c.email ILIKE '%${s}%' OR c.role ILIKE '%${s}%')`);
      }
      const whereClause = whereParts.join(' AND ');

      const [rows, countResult] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ id: string; email_count: bigint }>>(`
          SELECT c.id, COALESCE(ec.cnt, 0) AS email_count
          FROM contacts c
          JOIN customers cu ON c.customer_id = cu.id
          LEFT JOIN (
            SELECT "from", COUNT(*) AS cnt FROM emails WHERE user_id = '${userId}' GROUP BY "from"
          ) ec ON c.email = ec."from"
          WHERE ${whereClause}
          ORDER BY email_count DESC
          LIMIT ${pagination.limit} OFFSET ${pagination.skip}
        `),
        prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
          SELECT COUNT(*) as count FROM contacts c
          JOIN customers cu ON c.customer_id = cu.id
          WHERE ${whereClause}
        `),
      ]);

      const total = Number(countResult[0]?.count || 0);
      const orderedIds = rows.map(r => r.id);
      const emailCountMap = Object.fromEntries(rows.map(r => [r.id, Number(r.email_count)]));

      // Fetch full contact objects with includes
      const contacts = orderedIds.length > 0
        ? await prisma.contact.findMany({
            where: { id: { in: orderedIds } },
            include: {
              customer: { select: { id: true, name: true, domain: true, logoUrl: true } },
            },
          })
        : [];

      // Restore the SQL ordering
      const contactMap = new Map(contacts.map(c => [c.id, c]));
      const ordered = orderedIds
        .map(id => contactMap.get(id))
        .filter(Boolean)
        .map(c => ({ ...c!, _emailCount: emailCountMap[c!.id] || 0 }));

      return {
        data: ordered,
        meta: paginationMeta(total, pagination),
      };
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          customer: { select: { id: true, name: true, domain: true, logoUrl: true } },
        },
      }),
      prisma.contact.count({ where }),
    ]);

    // Still need email counts for the column display
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

    return {
      data: contacts.map(c => ({ ...c, _emailCount: c.email ? (emailCounts[c.email] || 0) : 0 })),
      meta: paginationMeta(total, pagination),
    };
  },

  async findByEmail(userId: string, email: string) {
    const contact = await prisma.contact.findFirst({
      where: { email, customer: { userId } },
      select: { id: true, firstName: true, lastName: true, email: true, customerId: true },
    });
    return contact;
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
    const contact = await prisma.contact.create({ data: cleaned as any });
    auditService.log({ userId, action: 'CONTACT_CREATED', entityType: 'contact', entityId: contact.id, details: { name: data.firstName + ' ' + data.lastName, email: data.email } });
    return contact;
  },

  async update(userId: string, id: string, data: UpdateContactInput) {
    const existing = await prisma.contact.findFirst({
      where: { id, customer: { userId } },
    });
    if (!existing) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    const cleaned = cleanEmptyStrings(data);
    const contact = await prisma.contact.update({ where: { id }, data: cleaned });
    auditService.log({ userId, action: 'CONTACT_UPDATED', entityType: 'contact', entityId: id, details: { changes: Object.keys(data) } });
    return contact;
  },

  async delete(userId: string, id: string) {
    const existing = await prisma.contact.findFirst({
      where: { id, customer: { userId } },
    });
    if (!existing) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    await prisma.contact.delete({ where: { id } });
    auditService.log({ userId, action: 'CONTACT_DELETED', entityType: 'contact', entityId: id, details: { name: existing.firstName + ' ' + existing.lastName } });
    return { success: true };
  },
};
