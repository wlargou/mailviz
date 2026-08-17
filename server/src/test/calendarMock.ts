import { vi, type Mock } from 'vitest';
import type { calendar_v3 } from 'googleapis';

/**
 * A fake Google Calendar client, substituted at `lib/calendar.ts#getCalendarClient`.
 *
 * The same approach as `gmailMock.ts`: replace the single module that builds the
 * client and everything below it — Prisma, the customer auto-linking, the
 * delete bookkeeping — runs for real against the test database. Calendar sync is
 * the path that deletes events in bulk, so what these tests are for is proving
 * exactly which rows a sync is allowed to remove.
 */

export interface CalendarMock {
  client: unknown;
  eventsList: Mock;
  eventsGet: Mock;
  eventsInsert: Mock;
  eventsUpdate: Mock;
  eventsDelete: Mock;
}

export function createCalendarMock(): CalendarMock {
  const eventsList = vi.fn().mockResolvedValue({ data: { items: [] } });
  const eventsGet = vi.fn().mockResolvedValue({ data: {} });
  const eventsInsert = vi.fn().mockResolvedValue({ data: { id: 'inserted' } });
  const eventsUpdate = vi.fn().mockResolvedValue({ data: { id: 'updated' } });
  const eventsDelete = vi.fn().mockResolvedValue({ data: {} });

  const client = {
    events: {
      list: eventsList,
      get: eventsGet,
      insert: eventsInsert,
      update: eventsUpdate,
      delete: eventsDelete,
    },
  };

  return { client, eventsList, eventsGet, eventsInsert, eventsUpdate, eventsDelete };
}

export interface FakeEvent {
  id: string;
  summary?: string;
  start?: string;
  end?: string;
  attendees?: Array<{ email: string; displayName?: string | null; self?: boolean }>;
  status?: string;
  recurringEventId?: string;
}

export function calendarEvent(event: FakeEvent): calendar_v3.Schema$Event {
  return {
    id: event.id,
    summary: event.summary ?? `Event ${event.id}`,
    status: event.status ?? 'confirmed',
    start: { dateTime: event.start ?? '2026-08-20T09:00:00.000Z' },
    end: { dateTime: event.end ?? '2026-08-20T10:00:00.000Z' },
    ...(event.attendees ? { attendees: event.attendees } : {}),
    ...(event.recurringEventId ? { recurringEventId: event.recurringEventId } : {}),
  };
}

/** One page of `events.list`. */
export function eventsPage(
  events: FakeEvent[],
  extra: { nextPageToken?: string; nextSyncToken?: string } = {}
) {
  return {
    data: {
      items: events.map(calendarEvent),
      ...(extra.nextPageToken ? { nextPageToken: extra.nextPageToken } : {}),
      ...(extra.nextSyncToken ? { nextSyncToken: extra.nextSyncToken } : {}),
    },
  };
}

/**
 * Answer `events.list` differently depending on the call's parameters, which is
 * how the token-acquisition call is told apart from the data call.
 */
export function stubEventsList(
  mock: CalendarMock,
  handler: (params: calendar_v3.Params$Resource$Events$List) => unknown
): void {
  mock.eventsList.mockImplementation(async (params: calendar_v3.Params$Resource$Events$List) =>
    handler(params ?? {})
  );
}

/** The 410 Google returns when a stored syncToken is too old to use. */
export function syncTokenExpiredError(): Error & { code: number } {
  return Object.assign(new Error('Sync token is no longer valid'), { code: 410 });
}

/** Every `events.list` call's parameters, for asserting request shape. */
export function listCalls(
  mock: CalendarMock
): calendar_v3.Params$Resource$Events$List[] {
  return mock.eventsList.mock.calls.map((call) => call[0] ?? {});
}
