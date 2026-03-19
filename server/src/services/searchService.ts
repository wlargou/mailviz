import { prisma } from '../lib/prisma.js';

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
}

const EMPTY: SearchResults = { emails: [], tasks: [], events: [], customers: [], contacts: [] };

export const searchService = {
  async search(query: string): Promise<SearchResults> {
    const q = query.trim();
    if (q.length < 2) return EMPTY;

    const [emails, tasks, events, customers, contacts] = await Promise.all([
      // Emails — distinct by threadId, newest first, exclude trashed
      prisma.email.findMany({
        where: {
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
    ]);

    return { emails, tasks, events, customers, contacts };
  },
};
