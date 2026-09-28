import { prisma } from '../lib/prisma.js';
import { RFP_TERMINAL_STATUSES } from '../utils/rfp.js';

interface SearchResults {
  emails: Array<{
    id: string;
    threadId: string | null;
    subject: string;
    from: string;
    fromName: string | null;
    snippet: string | null;
    receivedAt: Date;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: Date | null;
  }>;
  events: Array<{
    id: string;
    title: string;
    startTime: Date;
    endTime: Date;
    location: string | null;
  }>;
  customers: Array<{
    id: string;
    name: string;
    company: string | null;
    email: string | null;
    logoUrl: string | null;
  }>;
  contacts: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    role: string | null;
    customerId: string;
    customer: { name: string } | null;
  }>;
  deals: Array<{
    id: string;
    title: string;
    status: string;
    expiryDate: Date | null;
    partner: { name: string } | null;
    customer: { id: string; name: string } | null;
  }>;
  rfps: Array<{
    id: string;
    name: string;
    reference: string;
    status: string;
    deadlineAt: Date;
    customer: { id: string; name: string } | null;
  }>;
}

const EMPTY: SearchResults = { emails: [], tasks: [], events: [], customers: [], contacts: [], deals: [], rfps: [] };

type RfpHit = SearchResults['rfps'][number];

/**
 * Live tenders first, nearest deadline first — the one closing on Wednesday
 * is what someone typing "BKAM" is after. Then the rest, most recent first.
 */
export function rankRfps(rfps: RfpHit[], now = new Date()): RfpHit[] {
  const live = (r: RfpHit) => !(RFP_TERMINAL_STATUSES as readonly string[]).includes(r.status) && r.deadlineAt >= now;
  return [
    ...rfps.filter(live).sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime()),
    ...rfps.filter((r) => !live(r)).sort((a, b) => b.deadlineAt.getTime() - a.deadlineAt.getTime()),
  ];
}

export const searchService = {
  async search(query: string, userId: string): Promise<SearchResults> {
    const q = query.trim();
    if (q.length < 2) return EMPTY;

    const [emails, tasks, events, customers, contacts, deals, rfpRows] = await Promise.all([
      // Emails — distinct by threadId, newest first, exclude trashed
      prisma.email.findMany({
        where: {
          userId,
          isTrashed: false,
          OR: [
            { subject: { contains: q, mode: 'insensitive' } },
            { from: { contains: q, mode: 'insensitive' } },
            { fromName: { contains: q, mode: 'insensitive' } },
            { snippet: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          threadId: true,
          subject: true,
          from: true,
          fromName: true,
          snippet: true,
          receivedAt: true,
        },
        orderBy: { receivedAt: 'desc' },
        distinct: ['threadId'],
        take: 4,
      }),

      // Tasks — search title and description
      prisma.task.findMany({
        where: {
          userId,
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),

      // Calendar events — search title and description (new capability)
      prisma.calendarEvent.findMany({
        where: {
          userId,
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          title: true,
          startTime: true,
          endTime: true,
          location: true,
        },
        orderBy: { startTime: 'desc' },
        take: 4,
      }),

      // Customers — search name, company, email
      prisma.customer.findMany({
        where: {
          userId,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { company: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          name: true,
          company: true,
          email: true,
          logoUrl: true,
        },
        orderBy: { name: 'asc' },
        take: 4,
      }),

      // Contacts — search firstName, lastName, email
      prisma.contact.findMany({
        where: {
          customer: { userId },
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          customerId: true,
          customer: { select: { name: true } },
        },
        orderBy: { firstName: 'asc' },
        take: 4,
      }),

      // Deals — search title, products and notes
      prisma.deal.findMany({
        where: {
          userId,
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { products: { contains: q, mode: 'insensitive' } },
            { notes: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          title: true,
          status: true,
          expiryDate: true,
          partner: { select: { name: true } },
          customer: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),

      // RFPs — name, the buyer's reference, notes, and the buyer's name.
      // Owned only, like every other branch here. More than four are read so
      // the live ones can be ranked first before cutting to four.
      prisma.rfp.findMany({
        where: {
          AND: [
            { userId },
            {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { reference: { contains: q, mode: 'insensitive' } },
                { notes: { contains: q, mode: 'insensitive' } },
                { customer: { name: { contains: q, mode: 'insensitive' } } },
              ],
            },
          ],
        },
        select: {
          id: true,
          name: true,
          reference: true,
          status: true,
          deadlineAt: true,
          customer: { select: { id: true, name: true } },
        },
        orderBy: { deadlineAt: 'desc' },
        take: 12,
      }),
    ]);

    return { emails, tasks, events, customers, contacts, deals, rfps: rankRfps(rfpRows).slice(0, 4) };
  },
};
