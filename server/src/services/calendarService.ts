import { google } from 'googleapis';
import { prisma } from '../lib/prisma.js';
import { googleAuthService } from './googleAuthService.js';
import { customerService } from './customerService.js';
import { extractDomain, isPersonalDomain, normalizeDomain } from '../utils/domainResolver.js';
import type { Prisma } from '@prisma/client';

// Patterns to extract meeting links from event descriptions.
// Order matters — first match wins.
const MEETING_LINK_PATTERNS = [
  // Teams short join link
  /https:\/\/teams\.microsoft\.com\/meet\/[^\s<>")\]]+/i,
  // Teams full meetup-join link
  /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>")\]]+/i,
  // Zoom
  /https:\/\/[\w.-]*zoom\.(?:us|com)\/j\/[^\s<>")\]]+/i,
  // Webex
  /https:\/\/[\w.-]*\.webex\.com\/[\w.-]*\/j\.php[^\s<>")\]]+/i,
  /https:\/\/[\w.-]*\.webex\.com\/meet\/[^\s<>")\]]+/i,
  // Google Meet (fallback if conferenceData missed it)
  /https:\/\/meet\.google\.com\/[a-z-]+/i,
];

function extractMeetingLink(description: string | null | undefined): string | null {
  if (!description) return null;
  for (const pattern of MEETING_LINK_PATTERNS) {
    const match = description.match(pattern);
    if (match) return match[0];
  }
  return null;
}

export const calendarService = {
  async findAll(query: { start?: string; end?: string }) {
    const where: Prisma.CalendarEventWhereInput = {};

    if (query.start) {
      where.startTime = { gte: new Date(query.start) };
    }
    if (query.end) {
      where.endTime = { lte: new Date(query.end) };
    }

    const events = await prisma.calendarEvent.findMany({
      where,
      orderBy: { startTime: 'asc' },
      include: {
        customers: {
          include: { customer: { select: { id: true, name: true, domain: true, logoUrl: true } } },
        },
      },
    });

    return { data: events };
  },

  async findById(id: string) {
    const event = await prisma.calendarEvent.findUnique({
      where: { id },
      include: {
        customers: {
          include: { customer: { select: { id: true, name: true, domain: true, logoUrl: true } } },
        },
      },
    });
    if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });
    return event;
  },

  async create(data: {
    title: string;
    description?: string;
    startTime: string;
    endTime: string;
    location?: string;
    isAllDay?: boolean;
  }) {
    const event = await prisma.calendarEvent.create({
      data: {
        title: data.title,
        description: data.description,
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime),
        location: data.location,
        isAllDay: data.isAllDay ?? false,
      },
    });

    // Sync to Google if connected
    await this.pushToGoogle(event.id, 'create');

    return event;
  },

  async update(id: string, data: {
    title?: string;
    description?: string;
    startTime?: string;
    endTime?: string;
    location?: string;
    isAllDay?: boolean;
  }) {
    const updateData: Prisma.CalendarEventUpdateInput = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.startTime !== undefined) updateData.startTime = new Date(data.startTime);
    if (data.endTime !== undefined) updateData.endTime = new Date(data.endTime);
    if (data.location !== undefined) updateData.location = data.location;
    if (data.isAllDay !== undefined) updateData.isAllDay = data.isAllDay;

    const event = await prisma.calendarEvent.update({
      where: { id },
      data: updateData,
    });

    await this.pushToGoogle(event.id, 'update');

    return event;
  },

  async delete(id: string, mode: 'single' | 'all' = 'single') {
    const event = await prisma.calendarEvent.findUnique({ where: { id } });
    if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });

    if (mode === 'all' && event.recurringEventId && event.googleEventId) {
      // Delete the entire recurring series via Google Calendar API
      const oauth2Client = await googleAuthService.getAuthenticatedClient();
      if (oauth2Client) {
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        try {
          await calendar.events.delete({
            calendarId: 'primary',
            eventId: event.recurringEventId,
          });
        } catch (err) {
          console.error('Failed to delete recurring series on Google Calendar:', err);
        }
      }
      // Delete all local instances of this recurring series
      await prisma.calendarEvent.deleteMany({
        where: { recurringEventId: event.recurringEventId },
      });
    } else {
      // Delete single instance from Google
      if (event.googleEventId) {
        await this.pushToGoogle(id, 'delete');
      }
      await prisma.calendarEvent.delete({ where: { id } });
    }
  },

  async syncFromGoogle() {
    const oauth2Client = await googleAuthService.getAuthenticatedClient();
    if (!oauth2Client) throw Object.assign(new Error('Google Calendar not connected'), { status: 400 });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Fetch events from last 3 months to next 6 months
    const timeMin = new Date();
    timeMin.setMonth(timeMin.getMonth() - 3);
    const timeMax = new Date();
    timeMax.setMonth(timeMax.getMonth() + 6);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 500,
      singleEvents: true,
      orderBy: 'startTime',
      conferenceDataVersion: 1,
    } as any);

    const googleEvents = (response as any).data.items || [];
    let synced = 0;
    let customersCreated = 0;
    let contactsCreated = 0;

    // Cache parent recurring event RRULE data to attach to instances
    const recurrenceCache = new Map<string, string[]>();
    const getRecurrence = async (recurringEventId: string): Promise<string[]> => {
      if (recurrenceCache.has(recurringEventId)) return recurrenceCache.get(recurringEventId)!;
      try {
        const parent = await calendar.events.get({ calendarId: 'primary', eventId: recurringEventId });
        const rules = (parent.data.recurrence as string[] | undefined) || [];
        recurrenceCache.set(recurringEventId, rules);
        return rules;
      } catch {
        recurrenceCache.set(recurringEventId, []);
        return [];
      }
    };

    for (const gEvent of googleEvents) {
      if (!gEvent.id) continue;

      const isAllDay = !!gEvent.start?.date;
      const startTime = isAllDay
        ? new Date(gEvent.start!.date!)
        : new Date(gEvent.start!.dateTime!);
      const endTime = isAllDay
        ? new Date(gEvent.end!.date!)
        : new Date(gEvent.end!.dateTime!);

      // Extract attendees
      const attendees = gEvent.attendees?.map((a: any) => ({
        email: a.email || '',
        displayName: a.displayName || null,
        responseStatus: a.responseStatus || 'needsAction',
        self: a.self || false,
        organizer: a.organizer || false,
      })) || null;

      // Extract conference/meeting link
      let conferenceLink: string | null = null;
      if (gEvent.conferenceData?.entryPoints) {
        const videoEntry = gEvent.conferenceData.entryPoints.find(
          (ep: any) => ep.entryPointType === 'video'
        );
        if (videoEntry?.uri) {
          conferenceLink = videoEntry.uri;
        }
      }
      // Fallback: check hangoutLink
      if (!conferenceLink && gEvent.hangoutLink) {
        conferenceLink = gEvent.hangoutLink;
      }
      // Fallback: parse description for Teams/Zoom/Webex links
      if (!conferenceLink) {
        conferenceLink = extractMeetingLink(gEvent.description);
      }

      // Recurrence: instances have recurringEventId, parent has recurrence rules
      const recurringEventId = gEvent.recurringEventId || null;
      let recurrence: string[] = [];
      if (gEvent.recurrence) {
        recurrence = gEvent.recurrence as string[];
      } else if (recurringEventId) {
        recurrence = await getRecurrence(recurringEventId);
      }

      const eventData = {
        title: gEvent.summary || '(No title)',
        description: gEvent.description || null,
        startTime,
        endTime,
        location: gEvent.location || null,
        isAllDay,
        attendees: attendees as unknown as Prisma.InputJsonValue,
        conferenceLink,
        recurringEventId,
        recurrence,
        colorId: gEvent.colorId || null,
        syncedAt: new Date(),
      };

      const localEvent = await prisma.calendarEvent.upsert({
        where: { googleEventId: gEvent.id },
        update: eventData,
        create: {
          googleEventId: gEvent.id,
          calendarId: 'primary',
          ...eventData,
        },
      });
      synced++;

      // Auto-import customers and contacts from attendees
      if (attendees && Array.isArray(attendees)) {
        const customerIds = new Set<string>();

        for (const att of attendees as Array<{ email: string; displayName: string | null; self: boolean }>) {
          if (att.self) continue;
          const rawDomain = extractDomain(att.email);
          if (!rawDomain || isPersonalDomain(rawDomain)) continue;
          const domain = normalizeDomain(rawDomain);

          const { customer, created: customerCreated } = await customerService.findOrCreateByDomain(domain);
          customerIds.add(customer.id);
          if (customerCreated) customersCreated++;

          const { created: contactCreated } = await customerService.findOrCreateContact(att.email, att.displayName, customer.id);
          if (contactCreated) contactsCreated++;
        }

        for (const customerId of customerIds) {
          await prisma.calendarEventCustomer.upsert({
            where: { calendarEventId_customerId: { calendarEventId: localEvent.id, customerId } },
            update: {},
            create: { calendarEventId: localEvent.id, customerId },
          });
        }
      }
    }

    // Update lastSyncAt
    const auth = await prisma.googleAuth.findFirst();
    if (auth) {
      await prisma.googleAuth.update({
        where: { id: auth.id },
        data: { lastSyncAt: new Date() },
      });
    }

    return { synced, customersCreated, contactsCreated };
  },

  async respond(id: string, response: 'accepted' | 'declined' | 'tentative') {
    const event = await prisma.calendarEvent.findUnique({ where: { id } });
    if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });
    if (!event.googleEventId) throw Object.assign(new Error('Cannot respond to non-Google events'), { status: 400 });

    const oauth2Client = await googleAuthService.getAuthenticatedClient();
    if (!oauth2Client) throw Object.assign(new Error('Google Calendar not connected'), { status: 400 });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get the current event from Google to find the self attendee
    const gEvent = await calendar.events.get({
      calendarId: 'primary',
      eventId: event.googleEventId,
    });

    const attendees = gEvent.data.attendees || [];
    // Find the current user's attendee entry and update their response
    const updatedAttendees = attendees.map((a) => {
      if (a.self) {
        return { ...a, responseStatus: response };
      }
      return a;
    });

    // Patch the event with the updated attendee list
    const updatedEvent = await calendar.events.patch({
      calendarId: 'primary',
      eventId: event.googleEventId,
      requestBody: {
        attendees: updatedAttendees,
      },
    });

    // Update local attendees data
    const localAttendees = updatedEvent.data.attendees?.map((a) => ({
      email: a.email || '',
      displayName: a.displayName || null,
      responseStatus: a.responseStatus || 'needsAction',
      self: a.self || false,
      organizer: a.organizer || false,
    })) || null;

    const updated = await prisma.calendarEvent.update({
      where: { id },
      data: {
        attendees: localAttendees as unknown as Prisma.InputJsonValue,
        syncedAt: new Date(),
      },
    });

    return updated;
  },

  async pushToGoogle(eventId: string, action: 'create' | 'update' | 'delete') {
    const oauth2Client = await googleAuthService.getAuthenticatedClient();
    if (!oauth2Client) return; // Not connected, skip

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    try {
      if (action === 'create') {
        const event = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
        if (!event) return;

        const googleEvent = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: {
            summary: event.title,
            description: event.description || undefined,
            location: event.location || undefined,
            start: event.isAllDay
              ? { date: event.startTime.toISOString().split('T')[0] }
              : { dateTime: event.startTime.toISOString() },
            end: event.isAllDay
              ? { date: event.endTime.toISOString().split('T')[0] }
              : { dateTime: event.endTime.toISOString() },
          },
        });

        await prisma.calendarEvent.update({
          where: { id: eventId },
          data: { googleEventId: googleEvent.data.id, syncedAt: new Date() },
        });
      } else if (action === 'update') {
        const event = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
        if (!event?.googleEventId) return;

        await calendar.events.update({
          calendarId: 'primary',
          eventId: event.googleEventId,
          requestBody: {
            summary: event.title,
            description: event.description || undefined,
            location: event.location || undefined,
            start: event.isAllDay
              ? { date: event.startTime.toISOString().split('T')[0] }
              : { dateTime: event.startTime.toISOString() },
            end: event.isAllDay
              ? { date: event.endTime.toISOString().split('T')[0] }
              : { dateTime: event.endTime.toISOString() },
          },
        });

        await prisma.calendarEvent.update({
          where: { id: eventId },
          data: { syncedAt: new Date() },
        });
      } else if (action === 'delete') {
        const event = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
        if (!event?.googleEventId) return;

        await calendar.events.delete({
          calendarId: 'primary',
          eventId: event.googleEventId,
        });
      }
    } catch (err) {
      console.error(`Failed to ${action} event on Google Calendar:`, err);
    }
  },
};
