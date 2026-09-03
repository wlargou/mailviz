import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { getCalendarClient } from '../lib/calendar.js';
import { env } from '../config/env.js';
import { calendarService } from './calendarService.js';
import { createUser, createTwoUsers, createGoogleAuth } from '../test/factories.js';
import {
  createCalendarMock,
  eventsPage,
  listCalls,
  stubEventsList,
  syncTokenExpiredError,
  type CalendarMock,
} from '../test/calendarMock.js';

/**
 * Calendar sync — the only Google-facing path in the app that deletes rows in
 * bulk, and until these tests the only one with no coverage at all.
 *
 * What matters here is not how many events are imported but *which rows a sync
 * is allowed to remove*. A full sync used to begin by deleting every event the
 * user had, then re-import a ±window around today; anything outside that window,
 * and anything created locally and never pushed, was destroyed. Because a routine
 * 410 (expired sync token) routes into that same path, this happened during
 * ordinary operation rather than only on a first sync.
 */

vi.mock('../lib/calendar.js', () => ({ getCalendarClient: vi.fn() }));

let calendar: CalendarMock;
const originalEnv = {
  CALENDAR_SYNC_PAST_MONTHS: env.CALENDAR_SYNC_PAST_MONTHS,
  CALENDAR_SYNC_FUTURE_MONTHS: env.CALENDAR_SYNC_FUTURE_MONTHS,
};

beforeEach(() => {
  calendar = createCalendarMock();
  vi.mocked(getCalendarClient).mockResolvedValue(calendar.client as never);
});

afterEach(() => {
  vi.mocked(getCalendarClient).mockReset();
  env.CALENDAR_SYNC_PAST_MONTHS = originalEnv.CALENDAR_SYNC_PAST_MONTHS;
  env.CALENDAR_SYNC_FUTURE_MONTHS = originalEnv.CALENDAR_SYNC_FUTURE_MONTHS;
});

/** An event stored locally, as though a previous sync had imported it. */
async function localEvent(
  userId: string,
  overrides: Partial<{
    googleEventId: string | null;
    title: string;
    startTime: Date;
    pendingSince: Date | null;
  }> = {}
) {
  const start = overrides.startTime ?? new Date('2026-08-20T09:00:00.000Z');
  return prisma.calendarEvent.create({
    data: {
      userId,
      googleEventId: overrides.googleEventId === undefined ? `g-${Math.random().toString(36).slice(2)}` : overrides.googleEventId,
      title: overrides.title ?? 'Existing event',
      startTime: start,
      endTime: new Date(start.getTime() + 3_600_000),
      calendarId: 'primary',
      pendingSince: overrides.pendingSince ?? null,
    },
  });
}

function monthsFromNow(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}

describe('calendarService.syncFromGoogle — what a full sync may delete', () => {
  it('keeps an event outside the sync window — REGRESSION', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    env.CALENDAR_SYNC_PAST_MONTHS = 24;
    env.CALENDAR_SYNC_FUTURE_MONTHS = 12;

    // Five years back: real history, and outside any window the sync will list.
    const old = await localEvent(user.id, {
      title: 'Kickoff, five years ago',
      startTime: monthsFromNow(-60),
    });

    stubEventsList(calendar, () => eventsPage([]));
    await calendarService.syncFromGoogle(false, user.id);

    // The old clean-slate delete removed this. It is outside the window, so the
    // sync has no knowledge of it and no business deleting it.
    expect(await prisma.calendarEvent.findUnique({ where: { id: old.id } })).not.toBeNull();
  });

  it('keeps a locally created event that was never pushed to Google — REGRESSION', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    const localOnly = await localEvent(user.id, { googleEventId: null, title: 'Draft meeting' });

    stubEventsList(calendar, () => eventsPage([]));
    await calendarService.syncFromGoogle(false, user.id);

    // Google has never heard of it, so its absence from the response says nothing.
    expect(await prisma.calendarEvent.findUnique({ where: { id: localOnly.id } })).not.toBeNull();
  });

  it('does remove an in-window event Google no longer returns', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    // In-window and Google-sourced: this is the case the clean slate existed for
    // — a cancelled recurring instance, which `singleEvents: true` omits rather
    // than returning as cancelled.
    const vanished = await localEvent(user.id, {
      googleEventId: 'g-vanished',
      startTime: monthsFromNow(1),
    });

    stubEventsList(calendar, () => eventsPage([{ id: 'g-kept', start: monthsFromNow(2).toISOString() }]));
    await calendarService.syncFromGoogle(false, user.id);

    expect(await prisma.calendarEvent.findUnique({ where: { id: vanished.id } })).toBeNull();
  });

  it('keeps a local-only event even when Google does return events', async () => {
    // Exercises the branch where ids WERE seen: the two conditions on
    // googleEventId have to combine, not replace each other.
    const user = await createUser();
    await createGoogleAuth(user.id);
    const localOnly = await localEvent(user.id, {
      googleEventId: null,
      title: 'Never pushed',
      startTime: monthsFromNow(1),
    });

    stubEventsList(calendar, () => eventsPage([{ id: 'g-real', start: monthsFromNow(2).toISOString() }]));
    await calendarService.syncFromGoogle(false, user.id);

    expect(await prisma.calendarEvent.findUnique({ where: { id: localOnly.id } })).not.toBeNull();
  });

  it('does not touch another account events', async () => {
    const { alice, bob } = await createTwoUsers();
    await createGoogleAuth(alice.id);
    const bobEvent = await localEvent(bob.id, { googleEventId: 'g-bob', startTime: monthsFromNow(1) });

    stubEventsList(calendar, () => eventsPage([]));
    await calendarService.syncFromGoogle(false, alice.id);

    expect(await prisma.calendarEvent.findUnique({ where: { id: bobEvent.id } })).not.toBeNull();
  });

  it('reports only events it actually removed, not a wipe', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    await localEvent(user.id, { startTime: monthsFromNow(-60) });
    await localEvent(user.id, { googleEventId: null });

    stubEventsList(calendar, () => eventsPage([{ id: 'g-new' }]));
    const result = await calendarService.syncFromGoogle(false, user.id);

    // The clean slate counted its own wipe, so the UI was told thousands of
    // events had been deleted on an ordinary sync.
    expect(result.deleted).toBe(0);
  });
});

describe('calendarService.syncFromGoogle — sync token', () => {
  it('asks for the token with the same singleEvents shape as the data — REGRESSION', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    stubEventsList(calendar, (params) =>
      // A syncable request is one without timeMin/timeMax/orderBy; Google returns
      // nextSyncToken only for those.
      params.timeMin || params.orderBy
        ? eventsPage([{ id: 'g1' }])
        : eventsPage([{ id: 'g1' }], { nextSyncToken: 'token-abc' })
    );

    await calendarService.syncFromGoogle(false, user.id);

    // The token used to be fetched by a call with no `singleEvents`, so it
    // described the unexpanded recurring-master view while the data had been
    // imported as expanded instances. The next incremental sync then returned a
    // different shape of the same events.
    const tokenCall = listCalls(calendar).find((c) => !c.timeMin && !c.orderBy);
    expect(tokenCall).toBeDefined();
    expect(tokenCall?.singleEvents).toBe(true);

    const auth = await prisma.googleAuth.findFirst({ where: { userId: user.id } });
    expect(auth?.calendarSyncToken).toBe('token-abc');
  });

  it('never sends timeMin or orderBy together with a syncToken', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    await prisma.googleAuth.updateMany({
      where: { userId: user.id },
      data: { calendarSyncToken: 'existing-token' },
    });

    stubEventsList(calendar, () => eventsPage([], { nextSyncToken: 'token-next' }));
    await calendarService.syncFromGoogle(false, user.id);

    // Google rejects the combination outright.
    for (const call of listCalls(calendar).filter((c) => c.syncToken)) {
      expect(call.timeMin).toBeUndefined();
      expect(call.timeMax).toBeUndefined();
      expect(call.orderBy).toBeUndefined();
    }
  });

  it('recovers from an expired token reported only on response.status', async () => {
    // The check here was hand-rolled as `err.code === 410 || err.status === 410`
    // and missed the third form gaxios uses. A 410 that arrived that way was
    // not recognised as an expired token, so the full-sync fallback never ran
    // and the sync just failed. `googleErrorStatus` reads all three; the
    // sibling test above uses `{ code: 410 }`, which the old check already
    // caught, so it could not have shown this.
    const user = await createUser();
    await createGoogleAuth(user.id);
    await prisma.googleAuth.updateMany({
      where: { userId: user.id },
      data: { calendarSyncToken: 'stale-token' },
    });

    let sawStaleToken = false;
    stubEventsList(calendar, (params) => {
      if (params.syncToken === 'stale-token') {
        sawStaleToken = true;
        throw Object.assign(new Error('Sync token is no longer valid'), {
          response: { status: 410 },
        });
      }
      return eventsPage([{ id: 'g-fresh' }], { nextSyncToken: 'token-fresh' });
    });

    await calendarService.syncFromGoogle(false, user.id);

    expect(sawStaleToken).toBe(true);
    // It re-listed and stored a fresh token rather than giving up.
    const auth = await prisma.googleAuth.findFirstOrThrow({ where: { userId: user.id } });
    expect(auth.calendarSyncToken).toBe('token-fresh');
  });

  it('recovers from an expired token without wiping the calendar — REGRESSION', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    await prisma.googleAuth.updateMany({
      where: { userId: user.id },
      data: { calendarSyncToken: 'stale-token' },
    });
    const history = await localEvent(user.id, {
      title: 'Older than the window',
      startTime: monthsFromNow(-60),
    });

    let sawStaleToken = false;
    stubEventsList(calendar, (params) => {
      if (params.syncToken === 'stale-token') {
        sawStaleToken = true;
        throw syncTokenExpiredError();
      }
      return eventsPage([{ id: 'g-fresh' }], { nextSyncToken: 'token-fresh' });
    });

    await calendarService.syncFromGoogle(false, user.id);

    expect(sawStaleToken).toBe(true);
    // An expired token is routine. It must not cost the user their history.
    expect(await prisma.calendarEvent.findUnique({ where: { id: history.id } })).not.toBeNull();
    const auth = await prisma.googleAuth.findFirst({ where: { userId: user.id } });
    expect(auth?.calendarSyncToken).toBe('token-fresh');
  });
});

describe('calendarService.syncFromGoogle — a local edit Google never received', () => {
  /**
   * The hole the rest of the push work left open.
   *
   * create and update write locally first, then push. When that push fails the
   * user is told — but the row still says one thing and Google says another,
   * and the next full sync re-listed the window and wrote Google's version
   * over it. The edit vanished, silently, long after the toast that said it
   * had been saved.
   *
   * `pendingSince` marks those rows, and the sync leaves them alone.
   */
  it('does not overwrite a pending row with Google’s version', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    const event = await localEvent(user.id, {
      googleEventId: 'g-pending',
      title: 'Local title',
      pendingSince: new Date(),
    });
    stubEventsList(calendar, () =>
      eventsPage([{ id: 'g-pending', summary: 'Google title' }], { nextSyncToken: 't' })
    );

    await calendarService.syncFromGoogle(false, user.id);

    const row = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.title).toBe('Local title');
  });

  it('does overwrite a settled row, so the skip is not just a sync that does nothing', async () => {
    // Without this the test above passes against a sync that writes nothing at
    // all — the classic way a guard test proves less than it looks.
    const user = await createUser();
    await createGoogleAuth(user.id);
    const event = await localEvent(user.id, {
      googleEventId: 'g-clean',
      title: 'Local title',
      pendingSince: null,
    });
    stubEventsList(calendar, () =>
      eventsPage([{ id: 'g-clean', summary: 'Google title' }], { nextSyncToken: 't' })
    );

    await calendarService.syncFromGoogle(false, user.id);

    const row = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.title).toBe('Google title');
  });

  it('still imports companies from a pending event’s attendees', async () => {
    // The trap. Implementing the skip as an early return before the upsert
    // would leave the attendee-driven customer import below it unreachable —
    // and it needs the row id, so it cannot simply be moved above.
    const user = await createUser();
    await createGoogleAuth(user.id);
    await localEvent(user.id, {
      googleEventId: 'g-attendees',
      title: 'Local title',
      pendingSince: new Date(),
    });
    stubEventsList(calendar, () =>
      eventsPage(
        [{ id: 'g-attendees', summary: 'Google title', attendees: [{ email: 'someone@acme-co.test' }] }],
        { nextSyncToken: 't' }
      )
    );

    await calendarService.syncFromGoogle(false, user.id);

    const customer = await prisma.customer.findFirst({
      where: { userId: user.id, domain: 'acme-co.test' },
    });
    expect(customer).not.toBeNull();
  });

  it('does not delete a pending row that Google no longer lists', async () => {
    // The second clobber site. The window here is on the LOCAL startTime while
    // events.list was windowed on Google's — and an unpushed reschedule is
    // exactly what makes the two disagree, so absence proves nothing.
    const user = await createUser();
    await createGoogleAuth(user.id);
    const event = await localEvent(user.id, {
      googleEventId: 'g-moved',
      startTime: new Date('2026-08-21T09:00:00.000Z'),
      pendingSince: new Date(),
    });
    stubEventsList(calendar, () => eventsPage([{ id: 'g-other' }], { nextSyncToken: 't' }));

    await calendarService.syncFromGoogle(false, user.id);

    expect(await prisma.calendarEvent.findUnique({ where: { id: event.id } })).not.toBeNull();
  });
});

