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
  sortBy?: string;
  sortOrder?: string;
}

// Whitelist of sortable Contact columns. `sortBy` comes straight off the query
// string and is used as a Prisma orderBy key, so it must never be trusted raw.
const CONTACT_SORT_FIELDS = ['firstName', 'lastName', 'email', 'role', 'isVip', 'createdAt', 'updatedAt'] as const;

/**
 * Every address a contact answers to: its primary plus anything a merge folded
 * into it. Mail, events and attachments all join to contacts by address string,
 * so a merged contact is only whole if all of them are considered.
 */
function contactAddresses(contact: { email: string | null; emailAliases: Array<{ email: string }> }): string[] {
  const addresses = contact.email ? [contact.email] : [];
  for (const alias of contact.emailAliases) {
    if (!addresses.includes(alias.email)) addresses.push(alias.email);
  }
  return addresses;
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

    const requestedSort = query.sortBy || 'emailCount';
    const sortBy = (CONTACT_SORT_FIELDS as readonly string[]).includes(requestedSort)
      ? requestedSort
      : 'emailCount';
    const sortOrder: Prisma.SortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    if (sortBy === 'emailCount') {
      // Sort by email count across all pages. Uses parameterized Prisma.sql —
      // never interpolate query values into the SQL string.
      const conditions: Prisma.Sql[] = [Prisma.sql`cu.user_id = ${userId}`];
      if (query.customerId) {
        conditions.push(Prisma.sql`c.customer_id = ${query.customerId}`);
      }
      if (query.search) {
        const pattern = `%${query.search}%`;
        conditions.push(
          Prisma.sql`(c.first_name ILIKE ${pattern} OR c.last_name ILIKE ${pattern} OR c.email ILIKE ${pattern} OR c.role ILIKE ${pattern})`
        );
      }
      const whereClause = Prisma.join(conditions, ' AND ');

      const [rows, countResult] = await Promise.all([
        // The count spans a contact's primary address *and* any addresses it
        // absorbed in a merge — otherwise merging visibly loses history.
        prisma.$queryRaw<Array<{ id: string; email_count: bigint }>>(Prisma.sql`
          SELECT c.id, COALESCE(ec.cnt, 0) AS email_count
          FROM contacts c
          JOIN customers cu ON c.customer_id = cu.id
          LEFT JOIN (
            SELECT a.contact_id, SUM(f.cnt) AS cnt
            FROM (
              SELECT id AS contact_id, email FROM contacts WHERE email IS NOT NULL
              UNION ALL
              SELECT contact_id, email FROM contact_email_aliases
            ) a
            JOIN (
              SELECT "from", COUNT(*) AS cnt FROM emails WHERE user_id = ${userId} GROUP BY "from"
            ) f ON f."from" = a.email
            GROUP BY a.contact_id
          ) ec ON ec.contact_id = c.id
          WHERE ${whereClause}
          -- c.id for the same reason as the Prisma branch: without it, ties on
          -- email_count (most contacts have none) reshuffle between page queries.
          ORDER BY email_count DESC, c.id ASC
          LIMIT ${pagination.limit} OFFSET ${pagination.skip}
        `),
        prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
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
        orderBy: [{ [sortBy]: sortOrder }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          customer: { select: { id: true, name: true, domain: true, logoUrl: true } },
        },
      }),
      prisma.contact.count({ where }),
    ]);

    // Still need email counts for the column display. Merged-in addresses count
    // towards their surviving contact, same as the emailCount sort above.
    const aliasRows = contacts.length > 0
      ? await prisma.contactEmailAlias.findMany({
          where: { contactId: { in: contacts.map(c => c.id) } },
          select: { contactId: true, email: true },
        })
      : [];
    const addressesByContact = new Map<string, string[]>();
    for (const c of contacts) {
      addressesByContact.set(c.id, c.email ? [c.email] : []);
    }
    for (const row of aliasRows) {
      addressesByContact.get(row.contactId)?.push(row.email);
    }

    const contactEmails = Array.from(new Set([...addressesByContact.values()].flat()));
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
      data: contacts.map(c => ({
        ...c,
        _emailCount: (addressesByContact.get(c.id) ?? []).reduce(
          (sum, address) => sum + (emailCounts[address] || 0),
          0
        ),
      })),
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
        emailAliases: { select: { id: true, email: true, createdAt: true }, orderBy: { email: 'asc' } },
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
      include: { emailAliases: { select: { email: true } } },
    });
    if (!contact) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    // A merged contact answers to every address it absorbed, not just its primary.
    const addresses = contactAddresses(contact);
    if (addresses.length === 0) return [];

    // Find events where any of this contact's addresses appears in the JSON attendees array
    const events = await prisma.calendarEvent.findMany({
      where: {
        userId,
        OR: addresses.map((address) => ({
          attendees: {
            path: [],
            array_contains: [{ email: address }],
          },
        })),
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

      // Filter to events where any of the contact's addresses is in attendees
      return customerEvents
        .map((ce) => ce.calendarEvent)
        .filter((evt) => {
          const attendees = evt.attendees as unknown as Array<{ email: string }> | null;
          return attendees?.some((a) => addresses.includes(a.email));
        });
    }

    return events;
  },

  async findAttachments(userId: string, id: string) {
    const contact = await prisma.contact.findFirst({
      where: { id, customer: { userId } },
      include: { emailAliases: { select: { email: true } } },
    });
    if (!contact) {
      throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    }
    // Includes addresses absorbed by a merge, so attachments do not disappear.
    const addresses = contactAddresses(contact);
    if (addresses.length === 0) return [];

    return prisma.emailAttachment.findMany({
      where: {
        email: {
          userId,
          OR: [
            { from: { in: addresses } },
            { to: { hasSome: addresses } },
            { cc: { hasSome: addresses } },
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
