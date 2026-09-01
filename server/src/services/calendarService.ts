import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import { prisma } from '../lib/prisma.js';
import { resolveTimeZone, formatDateInZone } from '../utils/timezone.js';
import { getCalendarClient } from '../lib/calendar.js';
import { googleAuthService } from './googleAuthService.js';
import { customerService } from './customerService.js';
import { extractDomain, isPersonalDomain, normalizeDomain } from '../utils/domainResolver.js';
import { wsEmit, wsEmitToUser } from '../websocket.js';
import { env } from '../config/env.js';
import { Prisma } from '../lib/prismaClient.js';
import { auditService } from './auditService.js';
import type { EventReminders, EventVisibility } from '../validators/calendarValidator.js';

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

const VISIBILITY_VALUES: readonly EventVisibility[] = ['default', 'public', 'private', 'confidential'];

/** Google returns visibility as a free-form string — keep only values we model. */
function normalizeVisibility(raw: string | null | undefined): EventVisibility | null {
  return VISIBILITY_VALUES.find((v) => v === raw) ?? null;
}

/** Shape Google hands back on an event; every field is optional/nullable there. */
interface GoogleReminders {
  useDefault?: boolean | null;
  overrides?: Array<{ method?: string | null; minutes?: number | null }> | null;
}

/**
 * Narrow a reminders payload — from Google or from our own Json column — down
 * to the shape we persist, dropping override entries with an unknown method or
 * a missing offset. Overrides and useDefault are mutually exclusive, so an
 * event with overrides always ends up with useDefault:false.
 */
function normalizeReminders(raw: unknown): EventReminders | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as GoogleReminders;

  const overrides: Array<{ method: 'email' | 'popup'; minutes: number }> = [];
  for (const o of Array.isArray(source.overrides) ? source.overrides : []) {
    const method = o.method === 'email' ? 'email' : o.method === 'popup' ? 'popup' : null;
    if (!method || typeof o.minutes !== 'number') continue;
    overrides.push({ method, minutes: o.minutes });
  }

  if (overrides.length > 0) return { useDefault: false, overrides };
  return { useDefault: source.useDefault ?? true };
}

/** Json columns need Prisma.DbNull rather than a bare null to clear the value. */
function remindersColumn(
  reminders: EventReminders | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return reminders ? (reminders as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
}

export const calendarService = {
  async findAll(query: { start?: string; end?: string }, userId: string) {
    const where: Prisma.CalendarEventWhereInput = { userId };

    /**
     * Overlap, not containment.
     *
     * This used to ask for `startTime >= start AND endTime <= end`, which
     * returns only events wholly inside the window. An event that begins before
     * the window and runs into it fails the first test; one that begins inside
     * and runs past the end fails the second. So anything crossing a boundary
     * was returned by neither the query for the week it started in nor the one
     * for the week it ended in — invisible on both sides, with no error.
     *
     * An interval overlaps the half-open window [start, end) when it begins
     * before the window ends and ends after the window begins. A multi-day
     * event, an overnight flight, or a meeting spanning midnight is then
     * returned by both adjacent views, which is what a calendar should do.
     */
    if (query.end) {
      where.startTime = { lt: new Date(query.end) };
    }
    if (query.start) {
      where.endTime = { gt: new Date(query.start) };
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

  async findById(id: string, userId: string) {
    const event = await prisma.calendarEvent.findUnique({
      where: { id, userId },
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
    attendees?: { email: string }[];
    sendUpdates?: 'all' | 'externalOnly' | 'none';
    addGoogleMeet?: boolean;
    colorId?: string;
    recurrence?: string[];
    reminders?: EventReminders;
    visibility?: EventVisibility;
  }, userId: string) {
    const event = await prisma.calendarEvent.create({
      data: {
        userId,
        title: data.title,
        description: data.description,
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime),
        location: data.location,
        isAllDay: data.isAllDay ?? false,
        colorId: data.colorId || null,
        recurrence: data.recurrence ?? [],
        attendees: data.attendees ? (data.attendees as unknown as Prisma.InputJsonValue) : undefined,
        reminders: remindersColumn(data.reminders),
        visibility: data.visibility ?? null,
      },
    });

    // Sync to Google if connected
    await this.pushToGoogle(event.id, 'create', userId, {
      attendees: data.attendees,
      sendUpdates: data.sendUpdates,
      addGoogleMeet: data.addGoogleMeet,
      colorId: data.colorId,
      recurrence: data.recurrence,
      reminders: data.reminders,
      visibility: data.visibility,
    });

    // Re-fetch event after pushToGoogle updated it with Google response data
    const updated = await prisma.calendarEvent.findUnique({ where: { id: event.id } });
    auditService.log({ userId, action: 'EVENT_CREATED', entityType: 'event', entityId: event.id, details: { title: data.title, startTime: data.startTime, endTime: data.endTime } });
    return updated || event;
  },

  async update(id: string, data: {
    title?: string;
    description?: string;
    startTime?: string;
    endTime?: string;
    location?: string;
    isAllDay?: boolean;
    attendees?: { email: string }[];
    sendUpdates?: 'all' | 'externalOnly' | 'none';
    addGoogleMeet?: boolean;
    colorId?: string;
    recurrence?: string[];
    reminders?: EventReminders;
    visibility?: EventVisibility;
  }, userId: string) {
    const updateData: Prisma.CalendarEventUpdateInput = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.startTime !== undefined) updateData.startTime = new Date(data.startTime);
    if (data.endTime !== undefined) updateData.endTime = new Date(data.endTime);
    if (data.location !== undefined) updateData.location = data.location;
    if (data.isAllDay !== undefined) updateData.isAllDay = data.isAllDay;
    if (data.colorId !== undefined) updateData.colorId = data.colorId || null;
    if (data.attendees !== undefined) updateData.attendees = data.attendees as unknown as Prisma.InputJsonValue;
    if (data.reminders !== undefined) updateData.reminders = remindersColumn(data.reminders);
    if (data.visibility !== undefined) updateData.visibility = data.visibility;

    // Recurrence lives on the master event. A row that carries a recurringEventId
    // is a single instance of a series (its `recurrence` is a copy of the parent's),
    // so we never rewrite the rule from there — Google would reject it anyway.
    const existing = await prisma.calendarEvent.findUnique({ where: { id, userId } });
    // `findById`, `delete` and `respond` all raise a 404 here; `update` did not,
    // and instead let the `prisma.update` below fail on the same `where`. That
    // throws a raw P2025, so editing another account's event answered 500 where
    // every sibling operation on the same row answers 404.
    if (!existing) throw Object.assign(new Error('Event not found'), { status: 404 });
    const canEditRecurrence = !existing.recurringEventId;
    const recurrence = canEditRecurrence ? data.recurrence : undefined;
    if (recurrence !== undefined) updateData.recurrence = recurrence;

    const event = await prisma.calendarEvent.update({
      where: { id, userId },
      data: updateData,
    });

    await this.pushToGoogle(event.id, 'update', userId, {
      attendees: data.attendees,
      sendUpdates: data.sendUpdates,
      addGoogleMeet: data.addGoogleMeet,
      colorId: data.colorId,
      recurrence,
      reminders: data.reminders,
      visibility: data.visibility,
    });

    // Re-fetch event after pushToGoogle updated it with Google response data
    const updated = await prisma.calendarEvent.findUnique({ where: { id: event.id } });
    auditService.log({ userId, action: 'EVENT_UPDATED', entityType: 'event', entityId: id, details: { changes: Object.keys(data) } });
    return updated || event;
  },

  async delete(id: string, userId: string, mode: 'single' | 'all' = 'single') {
    const event = await prisma.calendarEvent.findUnique({ where: { id, userId } });
    if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });

    if (mode === 'all' && event.recurringEventId && event.googleEventId) {
      // Delete the entire recurring series via Google Calendar API
      const oauth2Client = await googleAuthService.getAuthenticatedClient(userId);
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
        where: { recurringEventId: event.recurringEventId, userId },
      });
    } else {
      // Delete single instance from Google
      if (event.googleEventId) {
        await this.pushToGoogle(id, 'delete', userId);
      }
      await prisma.calendarEvent.delete({ where: { id, userId } });
    }
    auditService.log({ userId, action: 'EVENT_DELETED', entityType: 'event', entityId: id, details: { title: event.title, startTime: event.startTime } });
  },

  async syncFromGoogle(retried = false, userId: string): Promise<{ synced: number; deleted: number; customersCreated: number; contactsCreated: number }> {
    const calendar = await getCalendarClient(userId);
    const auth = await prisma.googleAuth.findFirst({ where: { userId } });
    if (!auth) throw Object.assign(new Error('Google Calendar not connected'), { status: 400 });

    let synced = 0;
    let deleted = 0;
    let customersCreated = 0;
    let contactsCreated = 0;
    let nextSyncToken: string | null = null;

    // Cache parent recurring event RRULE data
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

    // The window a full sync covers. Computed once so the reconciliation below can
    // scope its deletes to exactly the range this sync had visibility of.
    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - env.CALENDAR_SYNC_PAST_MONTHS);
    const windowEnd = new Date();
    windowEnd.setMonth(windowEnd.getMonth() + env.CALENDAR_SYNC_FUTURE_MONTHS);

    const isFullSync = !auth.calendarSyncToken;
    // Google event ids seen in this sync. Only meaningful for a full sync, where
    // absence from the response is information; during an incremental sync the
    // response is a delta and says nothing about events it does not mention.
    const seenGoogleIds = new Set<string>();

    try {
      let pageToken: string | undefined;

      do {
        let response: any;

        if (auth.calendarSyncToken) {
          // Incremental sync — only fetch changes since last sync
          response = await calendar.events.list({
            calendarId: 'primary',
            syncToken: auth.calendarSyncToken,
            maxResults: 250,
            pageToken,
            conferenceDataVersion: 1,
          } as any);
        } else {
          /**
           * Full sync over the configured window.
           *
           * This used to begin by deleting every event the user had, on the
           * reasoning that `singleEvents: true` omits cancelled recurring
           * instances rather than returning them as cancelled, so there was no
           * other way to notice one had gone. The cost was everything else:
           * events outside the window and events created locally and never
           * pushed were destroyed too — and since a routine 410 routes here, that
           * happened during ordinary operation, not just on a first sync.
           *
           * The reconciliation after the loop achieves the same cleanup by
           * deleting only what this sync could actually see: Google-sourced events
           * inside the window that the response did not mention.
           */
          response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: windowStart.toISOString(),
            timeMax: windowEnd.toISOString(),
            maxResults: 500,
            singleEvents: true,
            orderBy: 'startTime',
            pageToken,
            conferenceDataVersion: 1,
          } as any);
        }

        const googleEvents = response.data.items || [];
        pageToken = response.data.nextPageToken || undefined;
        nextSyncToken = response.data.nextSyncToken || null;

        for (const gEvent of googleEvents) {
          if (!gEvent.id) continue;

          // Handle cancelled/deleted events
          if (gEvent.status === 'cancelled') {
            const result = await prisma.calendarEvent.deleteMany({
              where: { googleEventId: gEvent.id, userId },
            });
            if (result.count > 0) deleted++;
            continue;
          }

          if (isFullSync) seenGoogleIds.add(gEvent.id);
          const result = await this.upsertGoogleEvent(calendar, gEvent, recurrenceCache, getRecurrence, userId);
          synced++;
          customersCreated += result.customersCreated;
          contactsCreated += result.contactsCreated;
        }

        // Emit progress after each page
        wsEmitToUser(userId, 'sync:progress', { type: 'calendar', synced, total: 0, phase: 'syncing' });
      } while (pageToken);
    } catch (err: any) {
      // If syncToken is invalid/expired, fall back to full sync
      if ((err?.code === 410 || err?.status === 410) && !retried) {
        console.warn('[CalendarSync] Sync token expired, resetting for full sync');
        await prisma.googleAuth.update({
          where: { id: auth.id },
          data: { calendarSyncToken: null, lastSyncAt: new Date() },
        });
        // Recursive call will do a full sync since token is now null (retried=true prevents infinite loop)
        return this.syncFromGoogle(true, userId);
      }
      throw err;
    }

    /**
     * Remove Google-sourced events inside the window that this sync did not
     * return — the cancelled recurring instances that `singleEvents: true` omits
     * instead of reporting.
     *
     * Scoped three ways, each one a row the old clean slate destroyed:
     *  - `googleEventId: { not: null }` — an event created here and never pushed
     *    is unknown to Google, so its absence means nothing.
     *  - the window — outside it the response is silent by construction, not
     *    because the event is gone.
     *  - full syncs only — an incremental response is a delta, so absence from it
     *    is the normal case for every event that simply did not change.
     */
    if (isFullSync) {
      const orphans = await prisma.calendarEvent.deleteMany({
        where: {
          userId,
          startTime: { gte: windowStart, lte: windowEnd },
          // Both conditions are on `googleEventId`, so they go under AND. As
          // sibling keys the second silently replaced the first, leaving the
          // not-null guard off — it only behaved because SQL `NOT IN` does not
          // match NULL, which is the wrong reason for it to work.
          AND: [
            { googleEventId: { not: null } },
            ...(seenGoogleIds.size > 0
              ? [{ googleEventId: { notIn: [...seenGoogleIds] } }]
              : []),
          ],
        },
      });
      if (orphans.count > 0) {
        console.log(`[CalendarSync] Removed ${orphans.count} event(s) no longer on Google`);
        deleted += orphans.count;
      }
    }

    /**
     * A full sync cannot return a sync token: Google withholds `nextSyncToken`
     * from any request carrying `timeMin`, `timeMax` or `orderBy`, all of which
     * the windowed listing above needs. So the token is fetched separately.
     *
     * `singleEvents: true` matters here and was previously missing. A token
     * inherits the shape of the request that produced it, so one obtained without
     * it described the unexpanded recurring-master view while the data had been
     * stored as expanded instances — after the first incremental sync the same
     * event arrived in a different form than it was imported in.
     */
    if (!nextSyncToken && isFullSync) {
      try {
        let tokenPageToken: string | undefined;
        do {
          const tokenRes = await calendar.events.list({
            calendarId: 'primary',
            singleEvents: true,
            maxResults: 2500,
            pageToken: tokenPageToken,
          } as any);
          nextSyncToken = tokenRes.data.nextSyncToken || null;
          tokenPageToken = tokenRes.data.nextPageToken || undefined;
        } while (!nextSyncToken && tokenPageToken);
        if (nextSyncToken) {
          console.log('[CalendarSync] Obtained sync token for future incremental syncs');
        }
      } catch (e) {
        console.warn('[CalendarSync] Failed to obtain sync token:', (e as Error).message);
      }
    }

    // Store the new sync token for next incremental sync
    await prisma.googleAuth.update({
      where: { id: auth.id },
      data: {
        lastSyncAt: new Date(),
        ...(nextSyncToken ? { calendarSyncToken: nextSyncToken } : {}),
      },
    });

    wsEmitToUser(userId, 'sync:progress', { type: 'calendar', synced, total: synced, phase: 'complete' });
    return { synced, deleted, customersCreated, contactsCreated };
  },

  /** Upsert a single Google Calendar event into the local database */
  async upsertGoogleEvent(
    calendar: ReturnType<typeof google.calendar>,
    gEvent: any,
    recurrenceCache: Map<string, string[]>,
    getRecurrence: (id: string) => Promise<string[]>,
    userId: string,
  ) {
    let customersCreated = 0;
    let contactsCreated = 0;

    const isAllDay = !!gEvent.start?.date;
    const startTime = isAllDay
      ? new Date(gEvent.start!.date!)
      : new Date(gEvent.start!.dateTime!);
    const endTime = isAllDay
      ? new Date(gEvent.end!.date!)
      : new Date(gEvent.end!.dateTime!);

    const attendees = gEvent.attendees?.map((a: any) => ({
      email: a.email || '',
      displayName: a.displayName || null,
      responseStatus: a.responseStatus || 'needsAction',
      self: a.self || false,
      organizer: a.organizer || false,
    })) || null;

    let conferenceLink: string | null = null;
    if (gEvent.conferenceData?.entryPoints) {
      const videoEntry = gEvent.conferenceData.entryPoints.find(
        (ep: any) => ep.entryPointType === 'video'
      );
      if (videoEntry?.uri) conferenceLink = videoEntry.uri;
    }
    if (!conferenceLink && gEvent.hangoutLink) conferenceLink = gEvent.hangoutLink;
    if (!conferenceLink) conferenceLink = extractMeetingLink(gEvent.description);

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
      // Events created outside this app carry their own reminders/visibility —
      // store them so the UI shows what Google actually has.
      reminders: remindersColumn(normalizeReminders(gEvent.reminders)),
      visibility: normalizeVisibility(gEvent.visibility),
      syncedAt: new Date(),
    };

    const localEvent = await prisma.calendarEvent.upsert({
      where: { userId_googleEventId: { userId, googleEventId: gEvent.id } },
      update: eventData,
      create: {
        userId,
        googleEventId: gEvent.id,
        calendarId: 'primary',
        ...eventData,
      },
    });

    // Auto-import customers and contacts from attendees
    if (attendees && Array.isArray(attendees)) {
      const customerIds = new Set<string>();

      for (const att of attendees as Array<{ email: string; displayName: string | null; self: boolean }>) {
        if (att.self) continue;
        const rawDomain = extractDomain(att.email);
        if (!rawDomain || isPersonalDomain(rawDomain)) continue;
        const domain = normalizeDomain(rawDomain);

        const { customer, created: customerCreated } = await customerService.findOrCreateByDomain(userId, domain);
        customerIds.add(customer.id);
        if (customerCreated) customersCreated++;

        const { created: contactCreated } = await customerService.findOrCreateContact(userId, att.email, att.displayName, customer.id);
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

    return { customersCreated, contactsCreated };
  },

  async respond(id: string, response: 'accepted' | 'declined' | 'tentative', userId: string) {
    const event = await prisma.calendarEvent.findUnique({ where: { id, userId } });
    if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });
    if (!event.googleEventId) throw Object.assign(new Error('Cannot respond to non-Google events'), { status: 400 });

    const oauth2Client = await googleAuthService.getAuthenticatedClient(userId);
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

    auditService.log({ userId, action: 'EVENT_RESPONDED', entityType: 'event', entityId: id, details: { response } });

    return updated;
  },

  async pushToGoogle(
    eventId: string,
    action: 'create' | 'update' | 'delete',
    userId: string,
    extraData?: {
      attendees?: { email: string }[];
      sendUpdates?: 'all' | 'externalOnly' | 'none';
      addGoogleMeet?: boolean;
      colorId?: string;
      recurrence?: string[];
      reminders?: EventReminders;
      visibility?: EventVisibility;
    },
  ) {
    const oauth2Client = await googleAuthService.getAuthenticatedClient(userId);
    if (!oauth2Client) return; // Not connected, skip

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    /**
     * An all-day event is a calendar DATE, and which date depends on whose
     * calendar you are reading.
     *
     * These dates were derived with `toISOString().split('T')[0]`, i.e. the UTC
     * date. The client sends all-day bounds as local midnight, so for anyone
     * EAST of UTC that instant is the previous day in UTC: midnight on 15
     * September in Paris is 14 September 22:00Z, and Google was told the 14th.
     * The event then showed a day early — in Google Calendar, on every device
     * synced to it, and in every invitation sent from it.
     *
     * Unlike the dashboard, this one wrote wrong data into somebody else's
     * system, where it outlived any fix here until the event was edited again.
     */
    const owner = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
    const tz = resolveTimeZone(owner?.timezone);

    try {
      if (action === 'create') {
        const event = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
        if (!event) return;

        const requestBody: Record<string, any> = {
          summary: event.title,
          description: event.description || undefined,
          location: event.location || undefined,
          start: event.isAllDay
            ? { date: formatDateInZone(event.startTime, tz) }
            : { dateTime: event.startTime.toISOString() },
          end: event.isAllDay
            ? { date: formatDateInZone(event.endTime, tz) }
            : { dateTime: event.endTime.toISOString() },
        };

        if (extraData?.attendees) {
          requestBody.attendees = extraData.attendees;
        }
        if (extraData?.colorId) {
          requestBody.colorId = extraData.colorId;
        }
        if (extraData?.recurrence && extraData.recurrence.length > 0) {
          requestBody.recurrence = extraData.recurrence;
        }
        if (extraData?.reminders) {
          requestBody.reminders = extraData.reminders;
        }
        if (extraData?.visibility) {
          requestBody.visibility = extraData.visibility;
        }
        if (extraData?.addGoogleMeet) {
          requestBody.conferenceData = {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          };
        }

        const googleEvent = await calendar.events.insert({
          calendarId: 'primary',
          sendUpdates: extraData?.sendUpdates || 'all',
          conferenceDataVersion: extraData?.addGoogleMeet ? 1 : undefined,
          requestBody,
        } as any);

        // Read back conference link from response
        const hangoutLink = googleEvent.data.hangoutLink;
        const conferenceLink = (googleEvent.data as any).conferenceData?.entryPoints?.find(
          (ep: any) => ep.entryPointType === 'video',
        )?.uri || hangoutLink || null;

        // Read back attendees with response status
        const returnedAttendees = googleEvent.data.attendees?.map((a: any) => ({
          email: a.email || '',
          displayName: a.displayName || null,
          responseStatus: a.responseStatus || 'needsAction',
          self: a.self || false,
          organizer: a.organizer || false,
        })) || null;

        // A recurring insert returns the master event (recurrence set, no
        // recurringEventId). Persist exactly what Google echoed back so the
        // next incremental sync — which upserts this same googleEventId with
        // gEvent.recurrence — writes an identical value instead of fighting us.
        const returnedRecurrence = (googleEvent.data.recurrence as string[] | undefined) || null;

        // Same reasoning for reminders/visibility: Google fills in defaults we
        // never sent (e.g. reminders:{useDefault:true}, visibility:'default'),
        // so store its version rather than ours.
        const returnedReminders = normalizeReminders(googleEvent.data.reminders);
        const returnedVisibility = normalizeVisibility(googleEvent.data.visibility);

        await prisma.calendarEvent.update({
          where: { id: eventId },
          data: {
            googleEventId: googleEvent.data.id,
            syncedAt: new Date(),
            ...(conferenceLink ? { conferenceLink } : {}),
            ...(returnedAttendees ? { attendees: returnedAttendees as unknown as Prisma.InputJsonValue } : {}),
            ...(returnedRecurrence ? { recurrence: returnedRecurrence } : {}),
            ...(returnedReminders ? { reminders: remindersColumn(returnedReminders) } : {}),
            ...(returnedVisibility ? { visibility: returnedVisibility } : {}),
          },
        });
      } else if (action === 'update') {
        const event = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
        if (!event?.googleEventId) return;

        const requestBody: Record<string, any> = {
          summary: event.title,
          description: event.description || undefined,
          location: event.location || undefined,
          start: event.isAllDay
            ? { date: formatDateInZone(event.startTime, tz) }
            : { dateTime: event.startTime.toISOString() },
          end: event.isAllDay
            ? { date: formatDateInZone(event.endTime, tz) }
            : { dateTime: event.endTime.toISOString() },
        };

        if (extraData?.attendees) {
          requestBody.attendees = extraData.attendees;
        }
        if (extraData?.colorId) {
          requestBody.colorId = extraData.colorId;
        }
        if (event.colorId) {
          requestBody.colorId = requestBody.colorId ?? event.colorId;
        }
        // events.update is a full replace: omitting `recurrence` on a master
        // event would silently collapse the whole series into a single event.
        // An explicit empty array from extraData is how the caller clears it.
        if (extraData?.recurrence) {
          requestBody.recurrence = extraData.recurrence;
        }
        if (!event.recurringEventId && event.recurrence.length > 0) {
          requestBody.recurrence = requestBody.recurrence ?? event.recurrence;
        }
        // Also a full replace for these two: omitting `reminders` resets the
        // event to the calendar defaults and omitting `visibility` resets it to
        // 'default', so fall back to whatever we already have stored.
        const storedReminders = normalizeReminders(event.reminders);
        if (extraData?.reminders) {
          requestBody.reminders = extraData.reminders;
        } else if (storedReminders) {
          requestBody.reminders = storedReminders;
        }
        const visibility = extraData?.visibility ?? normalizeVisibility(event.visibility);
        if (visibility) {
          requestBody.visibility = visibility;
        }
        if (extraData?.addGoogleMeet) {
          requestBody.conferenceData = {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          };
        }

        const updatedGoogleEvent = await calendar.events.update({
          calendarId: 'primary',
          eventId: event.googleEventId,
          sendUpdates: extraData?.sendUpdates || 'all',
          conferenceDataVersion: 1,
          requestBody,
        } as any);

        // Read back conference link from response
        const hangoutLink = updatedGoogleEvent.data.hangoutLink;
        const conferenceLink = (updatedGoogleEvent.data as any).conferenceData?.entryPoints?.find(
          (ep: any) => ep.entryPointType === 'video',
        )?.uri || hangoutLink || null;

        // Read back attendees with response status
        const returnedAttendees = updatedGoogleEvent.data.attendees?.map((a: any) => ({
          email: a.email || '',
          displayName: a.displayName || null,
          responseStatus: a.responseStatus || 'needsAction',
          self: a.self || false,
          organizer: a.organizer || false,
        })) || null;

        // Mirror the create path: store Google's own view of the rule so the
        // sync path has nothing to correct.
        const returnedRecurrence = (updatedGoogleEvent.data.recurrence as string[] | undefined) || null;
        const returnedReminders = normalizeReminders(updatedGoogleEvent.data.reminders);
        const returnedVisibility = normalizeVisibility(updatedGoogleEvent.data.visibility);

        await prisma.calendarEvent.update({
          where: { id: eventId },
          data: {
            syncedAt: new Date(),
            ...(conferenceLink ? { conferenceLink } : {}),
            ...(returnedAttendees ? { attendees: returnedAttendees as unknown as Prisma.InputJsonValue } : {}),
            ...(returnedRecurrence ? { recurrence: returnedRecurrence } : {}),
            ...(returnedReminders ? { reminders: remindersColumn(returnedReminders) } : {}),
            ...(returnedVisibility ? { visibility: returnedVisibility } : {}),
          },
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
