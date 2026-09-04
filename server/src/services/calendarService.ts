import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import { prisma } from '../lib/prisma.js';
import { formatAllDayDate } from '../utils/timezone.js';
import { getCalendarClient } from '../lib/calendar.js';
import { googleAuthService } from './googleAuthService.js';
import { classifyGoogleError, googleErrorStatus, isAlreadyGone, type PushFailure } from '../lib/googleErrors.js';
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

/**
 * What a push to Google actually did.
 *
 * It used to return `undefined` from five places for four different reasons —
 * not connected, row gone, no Google event, and a swallowed failure — so the
 * caller could not tell "there was nothing to do" from "it broke". That is the
 * whole bug: the request answered success either way.
 *
 * Positive at every exit, so `skipped` can never be inferred from the absence
 * of a success. Only `failed` warns or blocks.
 */
export type PushOutcome =
  | { status: 'pushed' }
  | { status: 'skipped'; reason: 'not-connected' | 'row-missing' | 'no-google-event' }
  | { status: 'failed'; failure: PushFailure };

/**
 * Record what a push did to the row's pending marker. The only place that
 * clears it.
 *
 *  - `pushed`, or `skipped/not-connected` → clear. A user with no Google
 *    connected is not waiting for anything, and leaving them pending would warn
 *    and retry for exactly the people the warning is not for.
 *  - `failed` → keep. That is the divergence this column exists to record.
 *  - `skipped/no-google-event` → keep: the row has no Google event because an
 *    earlier create never landed, so it is still owed one.
 *  - `skipped/row-missing` → nothing to write.
 */
export async function settlePending(eventId: string, userId: string, push: PushOutcome) {
  const clear =
    push.status === 'pushed' ||
    (push.status === 'skipped' && push.reason === 'not-connected');
  if (!clear) return;

  await prisma.calendarEvent.updateMany({
    where: { id: eventId, userId, pendingSince: { not: null } },
    data: { pendingSince: null },
  });
}

/**
 * Rebuild `pushToGoogle`'s `extraData` from a stored row, for a retry that has
 * no request to read it from.
 *
 * Every field here is one `pushToGoogle` sends only when handed it, and
 * `events.update` is a full replace — so a retry passing none of them would
 * strip the attendees, colour, recurrence, reminders and visibility off the
 * Google event, and at the default `sendUpdates` mail everyone about it.
 */
export function pushExtrasFromRow(event: {
  attendees: Prisma.JsonValue;
  colorId: string | null;
  recurrence: string[];
  recurringEventId: string | null;
  reminders: Prisma.JsonValue;
  visibility: string | null;
}) {
  const attendees = Array.isArray(event.attendees)
    ? (event.attendees as Array<{ email?: string }>).flatMap((a) => (a?.email ? [{ email: a.email }] : []))
    : undefined;

  return {
    attendees,
    colorId: event.colorId ?? undefined,
    // Never rewrite the rule from a series instance — `update` refuses for the
    // same reason, and Google would reject it.
    recurrence: event.recurringEventId ? undefined : event.recurrence,
    reminders: normalizeReminders(event.reminders) ?? undefined,
    visibility: normalizeVisibility(event.visibility) ?? undefined,
  };
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
        description: data.description || null,
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime),
        location: data.location || null,
        isAllDay: data.isAllDay ?? false,
        colorId: data.colorId || null,
        recurrence: data.recurrence ?? [],
        attendees: data.attendees ? (data.attendees as unknown as Prisma.InputJsonValue) : undefined,
        reminders: remindersColumn(data.reminders),
        visibility: data.visibility ?? null,
        // Write-ahead: pending until the push below says otherwise.
        pendingSince: new Date(),
      },
    });

    // Sync to Google if connected
    const push = await this.pushToGoogle(event.id, 'create', userId, {
      attendees: data.attendees,
      sendUpdates: data.sendUpdates,
      addGoogleMeet: data.addGoogleMeet,
      colorId: data.colorId,
      recurrence: data.recurrence,
      reminders: data.reminders,
      visibility: data.visibility,
    });

    // Re-fetch event after pushToGoogle updated it with Google response data
    await settlePending(event.id, userId, push);

    const updated = await prisma.calendarEvent.findUnique({ where: { id: event.id } });
    // Logged whether or not the push landed: the writes that fail to reach
    // Google are exactly the ones that later diverge and need explaining.
    auditService.log({ userId, action: 'EVENT_CREATED', entityType: 'event', entityId: event.id, details: { title: data.title, startTime: data.startTime, endTime: data.endTime } });
    return { event: updated || event, push };
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
    if (data.description !== undefined) updateData.description = data.description || null;
    if (data.startTime !== undefined) updateData.startTime = new Date(data.startTime);
    if (data.endTime !== undefined) updateData.endTime = new Date(data.endTime);
    if (data.location !== undefined) updateData.location = data.location || null;
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
    // Always a fresh timestamp, never `existing.pendingSince ?? new Date()`. A
    // new save is a new attempt, and resetting the clock is what puts a row
    // that aged out of the retry window back into it — the user's escape hatch.
    updateData.pendingSince = new Date();

    const event = await prisma.calendarEvent.update({
      where: { id, userId },
      data: updateData,
    });

    const push = await this.pushToGoogle(event.id, 'update', userId, {
      attendees: data.attendees,
      sendUpdates: data.sendUpdates,
      addGoogleMeet: data.addGoogleMeet,
      colorId: data.colorId,
      recurrence,
      reminders: data.reminders,
      visibility: data.visibility,
    });

    // Re-fetch event after pushToGoogle updated it with Google response data
    await settlePending(event.id, userId, push);

    const updated = await prisma.calendarEvent.findUnique({ where: { id: event.id } });
    auditService.log({ userId, action: 'EVENT_UPDATED', entityType: 'event', entityId: id, details: { changes: Object.keys(data) } });
    return { event: updated || event, push };
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
          // Already gone in Google is the outcome we wanted; anything else must
          // stop the deleteMany below from removing a series still live there.
          if (!isAlreadyGone(err)) {
            console.error('Failed to delete recurring series on Google Calendar:', err);
            throw Object.assign(
              new Error(
                `Could not delete this series from Google Calendar. ${classifyGoogleError(err).message}`
              ),
              { status: 502 }
            );
          }
        }
      }
      // Delete all local instances of this recurring series
      await prisma.calendarEvent.deleteMany({
        where: { recurringEventId: event.recurringEventId, userId },
      });
    } else {
      // Delete single instance from Google
      if (event.googleEventId) {
        const push = await this.pushToGoogle(id, 'delete', userId);
        /**
         * Unlike create and update, the push here happens BEFORE the local
         * write — so aborting leaves the database and Google in agreement and
         * makes the error honest rather than a lie about a committed change.
         *
         * 502, never Google's own status: a 401 propagated from a lapsed
         * Google grant would reach the client's axios interceptor and log the
         * user out of Mailviz, whose session is perfectly valid.
         */
        if (push.status === 'failed') {
          throw Object.assign(
            new Error(`Could not delete this event from Google Calendar. ${push.failure.message}`),
            { status: 502 }
          );
        }
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
      if (googleErrorStatus(err) === 410 && !retried) {
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
          // A pending row's absence from the listing is uninformative by
          // construction: this window is on the LOCAL startTime while
          // `events.list` was windowed on Google's, and an unpushed edit is
          // exactly what makes the two disagree. Move an event from a year out
          // to next week, have the push fail, and without this it is deleted.
          pendingSince: null,
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

    const key = { userId_googleEventId: { userId, googleEventId: gEvent.id } };

    /**
     * The update is gated on `pendingSince: null`; the insert is not.
     *
     * A row carrying a local edit we have not managed to push is the one row a
     * sync must not write — `eventData` is almost entirely columns `update`
     * writes, so refreshing it reverts an edit this app told the user it had
     * saved and Google does not have. That silent revert is the whole bug.
     *
     * `updateMany` rather than `upsert` because an upsert's update branch
     * cannot carry a condition. And deliberately not an early return: the
     * attendee-driven customer and contact import below runs for every event
     * Google returns, pending or not, and needs this row's id.
     */
    const { count } = await prisma.calendarEvent.updateMany({
      where: { userId, googleEventId: gEvent.id, pendingSince: null },
      data: eventData,
    });

    const localEvent =
      count > 0
        ? (await prisma.calendarEvent.findUniqueOrThrow({ where: key }))
        : await prisma.calendarEvent.upsert({
            // `count === 0` is either "no row yet" or "a pending row we just
            // declined to write". `update: {}` covers the second: it returns
            // the row without changing a field.
            where: key,
            update: {},
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

    type LocalAttendee = {
      email: string;
      displayName: string | null;
      responseStatus: string;
      self: boolean;
      organizer: boolean;
    };
    let localAttendees: LocalAttendee[] | null = null;

    try {
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
      localAttendees = updatedEvent.data.attendees?.map((a) => ({
        email: a.email || '',
        displayName: a.displayName || null,
        responseStatus: a.responseStatus || 'needsAction',
        self: a.self || false,
        organizer: a.organizer || false,
      })) || null;
    } catch (err) {
      /**
       * Both Google calls run before the only local write, so — unlike create
       * and update, which warn about a change already committed — there is
       * nothing here to keep. This throws.
       *
       * 502, and never Google's own status. gaxios sets a numeric `.status` on
       * the error and `errorHandler` passes any non-500 straight through, so a
       * 401 from a lapsed Google grant reached the client's axios interceptor
       * and logged the user out of Mailviz over a session that was perfectly
       * valid. It also put Google's raw message in the response, which is what
       * the sanitised text in `googleErrors` exists to avoid.
       *
       * Not 404 for "gone in Google" either: every 404 from this service means
       * "the local row is absent or not yours", and the client acts on that by
       * dropping the row — which still exists here. The distinction lives in
       * the message instead.
       */
      console.error('Failed to send RSVP to Google Calendar:', err);
      const detail = isAlreadyGone(err)
        ? 'This event no longer exists in Google Calendar.'
        : classifyGoogleError(err).message;
      throw Object.assign(
        new Error(`Could not send your response to Google Calendar. ${detail}`),
        { status: 502 }
      );
    }

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
  ): Promise<PushOutcome> {
    const oauth2Client = await googleAuthService.getAuthenticatedClient(userId);
    if (!oauth2Client) return { status: 'skipped', reason: 'not-connected' };

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    /**
     * All-day dates are read in UTC, deliberately, and need no user timezone.
     *
     * An all-day event has no timezone: "the 10th" is the 10th wherever it is
     * read. This app stores that floating date as UTC midnight — which is what
     * the inbound sync above already writes from Google's bare `date` — so the
     * date is recovered by formatting in UTC and by nothing else.
     *
     * An earlier version of this formatted in the *user's* zone. That is right
     * for an event whose bounds were written as local midnight and wrong for
     * one synced from Google, which is stored as UTC midnight: at a negative
     * offset it reports the previous day and the event walks backwards a day
     * per edit. Two storage conventions cannot both be read by one rule, so the
     * conventions were unified instead — see `formatAllDayDate`.
     */

    try {
      if (action === 'create') {
        const event = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
        if (!event) return { status: 'skipped', reason: 'row-missing' };

        const requestBody: Record<string, any> = {
          summary: event.title,
          description: event.description || undefined,
          location: event.location || undefined,
          start: event.isAllDay
            ? { date: formatAllDayDate(event.startTime) }
            : { dateTime: event.startTime.toISOString() },
          // Google's all-day `end.date` is EXCLUSIVE, and the stored endTime is
          // already the midnight after the last day — the same shape the
          // inbound sync writes — so this passes straight through.
          end: event.isAllDay
            ? { date: formatAllDayDate(event.endTime) }
            : { dateTime: event.endTime.toISOString() },
        };

        // Consistency with the update body below. Behaviour-neutral: arrays are
        // always truthy and the validator makes `null` unreachable. A new event
        // has no prior guest list to clear, so no fallback belongs here.
        if (extraData?.attendees !== undefined) {
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
        if (!event?.googleEventId) return { status: 'skipped', reason: 'no-google-event' };

        const requestBody: Record<string, any> = {
          summary: event.title,
          // Sent explicitly rather than omitted. `events.update` is a full
          // replace, so an omitted field is CLEARED — the same property the
          // recurrence note below relies on — which means `|| undefined` here
          // already happened to do the right thing. But it means the OPPOSITE
          // of what it means in EventModal, where a dropped key reads as
          // "leave alone", so the clear is spelled out: it stays correct if
          // this ever moves to `events.patch`, where only an explicit ''
          // clears. The insert body above is deliberately left as-is — a new
          // event has no prior value to clear.
          description: event.description ?? '',
          location: event.location ?? '',
          start: event.isAllDay
            ? { date: formatAllDayDate(event.startTime) }
            : { dateTime: event.startTime.toISOString() },
          // Google's all-day `end.date` is EXCLUSIVE, and the stored endTime is
          // already the midnight after the last day — the same shape the
          // inbound sync writes — so this passes straight through.
          end: event.isAllDay
            ? { date: formatAllDayDate(event.endTime) }
            : { dateTime: event.endTime.toISOString() },
        };

        /**
         * Fall back to the stored row, exactly as colour, recurrence, reminders
         * and visibility below already do — attendees was the only field in
         * this full-replace body without it.
         *
         * Omitting the key CLEARED the Google guest list and, at the default
         * `sendUpdates`, mailed every one of them about it. The local column
         * kept them, so the row diverged; the push reported success, so
         * `settlePending` cleared its protection; and the next sync wrote
         * Google's now-empty list back over it. The bug erased its own
         * evidence.
         *
         * Through `pushExtrasFromRow`, which strips to `{ email }`. Never the
         * raw column: `responseStatus` is writable and the stored copy is a
         * snapshot a diverged row freezes, so pushing it back would re-RSVP for
         * the guests — the same reason `respond()` re-reads from Google first.
         *
         * `??`, not `||` or a `.length` check: an explicit `[]` is how the user
         * says "remove everyone", and it has to survive.
         */
        const attendeesToSend = extraData?.attendees ?? pushExtrasFromRow(event).attendees;
        if (attendeesToSend !== undefined) {
          requestBody.attendees = attendeesToSend;
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
        if (!event?.googleEventId) return { status: 'skipped', reason: 'no-google-event' };

        await calendar.events.delete({
          calendarId: 'primary',
          eventId: event.googleEventId,
        });
      }
      return { status: 'pushed' };
    } catch (err) {
      // A delete treats "already gone" as success. Otherwise a row whose Google
      // event was removed in Google's own UI can never be deleted here: every
      // attempt repeats the same 404.
      if (action === 'delete' && isAlreadyGone(err)) return { status: 'pushed' };
      console.error(`Failed to ${action} event on Google Calendar:`, err);
      return { status: 'failed', failure: classifyGoogleError(err) };
    }
  },
};
