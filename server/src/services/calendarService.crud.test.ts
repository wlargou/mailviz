import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { google, type calendar_v3 } from 'googleapis';
import { prisma } from '../lib/prisma.js';
import { getCalendarClient } from '../lib/calendar.js';
import { calendarService } from './calendarService.js';
import { createUser, createTwoUsers, createGoogleAuth, createCustomer } from '../test/factories.js';
import { createCalendarMock, type CalendarMock } from '../test/calendarMock.js';

/**
 * The half of `calendarService` that is not sync: reading, creating, editing,
 * deleting and RSVPing to events.
 *
 * `calendarService.sync.test.ts` covers what a sync may delete. This file covers
 * the other way rows disappear — a user asking for it — and the question that
 * matters for every one of these entry points is *whose* rows. The service takes
 * `userId` on every method and threads it into the `where`; drop it from any one
 * of them and one account can read, rewrite or delete another account's
 * calendar. `delete(mode: 'all')` is the worst of them: it matches on a Google
 * `recurringEventId`, which is a shared identifier — two people invited to the
 * same weekly meeting hold rows carrying the same value.
 *
 * Two seams are stubbed. `lib/calendar.ts#getCalendarClient` is the documented
 * one, but the CRUD path does not use it: `pushToGoogle`, `respond` and the
 * recurring delete each build `google.calendar({ auth })` inline, so
 * `google.calendar` is stubbed as well. Whether Google is reachable at all is
 * then decided by the real `getAuthenticatedClient`, i.e. by whether the test
 * gave the user a GoogleAuth row.
 */

vi.mock('../lib/calendar.js', () => ({ getCalendarClient: vi.fn() }));

let calendar: CalendarMock;
let eventsPatch: Mock;

/**
 * `respond` calls `events.patch`, which the shared calendar mock does not model
 * (sync never patches). Extend it here rather than in the shared fixture.
 */
function withPatch(mock: CalendarMock) {
  const patch: Mock = vi.fn().mockResolvedValue({ data: {} });
  const base = mock.client as { events: Record<string, Mock> };
  return { client: { events: { ...base.events, patch } }, patch };
}

beforeEach(() => {
  calendar = createCalendarMock();
  const extended = withPatch(calendar);
  eventsPatch = extended.patch;

  vi.spyOn(google, 'calendar').mockReturnValue(extended.client as unknown as calendar_v3.Calendar);
  vi.mocked(getCalendarClient).mockResolvedValue(extended.client as never);

  // Nothing here should ever reach Google's token endpoint. Fixtures store a
  // token an hour from expiry so the proactive refresh never fires; this makes
  // a mistake fail loudly instead of making a real HTTPS request.
  vi.spyOn(google.auth.OAuth2.prototype, 'refreshAccessToken').mockImplementation(async () => {
    throw new Error('refreshAccessToken must not be reached in tests');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** An event as a previous sync (or a previous create) would have left it. */
async function localEvent(
  userId: string,
  overrides: Partial<{
    title: string;
    startTime: Date;
    endTime: Date;
    googleEventId: string | null;
    recurringEventId: string | null;
    recurrence: string[];
    description: string;
    location: string;
  }> = {}
) {
  const start = overrides.startTime ?? new Date('2026-08-20T09:00:00.000Z');
  return prisma.calendarEvent.create({
    data: {
      userId,
      title: overrides.title ?? 'Weekly sync',
      startTime: start,
      endTime: overrides.endTime ?? new Date(start.getTime() + 3_600_000),
      calendarId: 'primary',
      googleEventId:
        overrides.googleEventId === undefined
          ? `g-${Math.random().toString(36).slice(2)}`
          : overrides.googleEventId,
      ...(overrides.recurringEventId ? { recurringEventId: overrides.recurringEventId } : {}),
      ...(overrides.recurrence ? { recurrence: overrides.recurrence } : {}),
      ...(overrides.description ? { description: overrides.description } : {}),
      ...(overrides.location ? { location: overrides.location } : {}),
    },
  });
}

describe('calendarService.findAll', () => {
  it('returns only the calling account events — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await localEvent(alice.id, { title: 'Mine' });
    await localEvent(bob.id, { title: 'Not mine' });

    const { data } = await calendarService.findAll({}, alice.id);

    expect(data.map((e) => e.id)).toEqual([mine.id]);
  });

  it('filters to the requested range', async () => {
    const user = await createUser();
    const inside = await localEvent(user.id, {
      title: 'Inside',
      startTime: new Date('2026-08-20T09:00:00.000Z'),
    });
    await localEvent(user.id, { title: 'Before', startTime: new Date('2026-07-01T09:00:00.000Z') });
    await localEvent(user.id, { title: 'After', startTime: new Date('2026-09-30T09:00:00.000Z') });

    const { data } = await calendarService.findAll(
      { start: '2026-08-01T00:00:00.000Z', end: '2026-08-31T23:59:59.000Z' },
      user.id
    );

    expect(data.map((e) => e.id)).toEqual([inside.id]);
  });

  it('returns events that cross the start of the range — REGRESSION', async () => {
    // The filter was containment (`startTime >= start AND endTime <= end`), so
    // an event beginning before the window and running into it failed the first
    // test and an event running past the end failed the second. Neither was
    // returned by the window it started in NOR the one it ended in: invisible on
    // both sides, silently.
    const user = await createUser();
    const straddlesStart = await localEvent(user.id, {
      title: 'Overnight into the window',
      startTime: new Date('2026-07-31T22:00:00.000Z'),
      endTime: new Date('2026-08-01T02:00:00.000Z'),
    });

    const { data } = await calendarService.findAll(
      { start: '2026-08-01T00:00:00.000Z', end: '2026-08-31T23:59:59.000Z' },
      user.id
    );

    expect(data.map((e) => e.id)).toContain(straddlesStart.id);
  });

  it('returns events that cross the end of the range — REGRESSION', async () => {
    const user = await createUser();
    const straddlesEnd = await localEvent(user.id, {
      title: 'Runs past the window',
      startTime: new Date('2026-08-31T22:00:00.000Z'),
      endTime: new Date('2026-09-01T02:00:00.000Z'),
    });

    const { data } = await calendarService.findAll(
      { start: '2026-08-01T00:00:00.000Z', end: '2026-08-31T23:59:59.000Z' },
      user.id
    );

    expect(data.map((e) => e.id)).toContain(straddlesEnd.id);
  });

  it('returns a multi-day event that spans the whole window', async () => {
    // Contained by nothing: it starts before and ends after. Containment
    // excluded it from every window it actually covers.
    const user = await createUser();
    const spanning = await localEvent(user.id, {
      title: 'Two-week conference',
      startTime: new Date('2026-07-25T09:00:00.000Z'),
      endTime: new Date('2026-09-05T17:00:00.000Z'),
    });

    const { data } = await calendarService.findAll(
      { start: '2026-08-01T00:00:00.000Z', end: '2026-08-31T23:59:59.000Z' },
      user.id
    );

    expect(data.map((e) => e.id)).toEqual([spanning.id]);
  });

  it('still excludes events that only touch the boundary or miss entirely', async () => {
    // Overlap must not become "everything". An event ending exactly when the
    // window opens does not overlap it.
    const user = await createUser();
    await localEvent(user.id, {
      title: 'Ends exactly at the window start',
      startTime: new Date('2026-07-31T20:00:00.000Z'),
      endTime: new Date('2026-08-01T00:00:00.000Z'),
    });
    await localEvent(user.id, {
      title: 'Entirely before',
      startTime: new Date('2026-07-01T09:00:00.000Z'),
      endTime: new Date('2026-07-01T10:00:00.000Z'),
    });

    const { data } = await calendarService.findAll(
      { start: '2026-08-01T00:00:00.000Z', end: '2026-08-31T23:59:59.000Z' },
      user.id
    );

    expect(data).toEqual([]);
  });

  it('keeps the range filter scoped to the caller — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await localEvent(alice.id, {
      title: 'Mine',
      startTime: new Date('2026-08-20T09:00:00.000Z'),
    });
    // Same window, another account. A `where` rebuilt around the date range —
    // the shape that has already leaked deals and email here — drops the
    // ownership filter and puts this row in Alice's month view.
    await localEvent(bob.id, { title: 'Bob standup', startTime: new Date('2026-08-21T09:00:00.000Z') });

    const { data } = await calendarService.findAll(
      { start: '2026-08-01T00:00:00.000Z', end: '2026-08-31T23:59:59.000Z' },
      alice.id
    );

    expect(data.map((e) => e.id)).toEqual([mine.id]);
  });

  it('orders by start time, which is the order the calendar grid renders', async () => {
    const user = await createUser();
    const late = await localEvent(user.id, { startTime: new Date('2026-08-20T16:00:00.000Z') });
    const early = await localEvent(user.id, { startTime: new Date('2026-08-20T08:00:00.000Z') });
    const middle = await localEvent(user.id, { startTime: new Date('2026-08-20T12:00:00.000Z') });

    const { data } = await calendarService.findAll({}, user.id);

    expect(data.map((e) => e.id)).toEqual([early.id, middle.id, late.id]);
  });

  it('includes the companies an event is linked to', async () => {
    const user = await createUser();
    const customer = await createCustomer(user.id, { name: 'Initech', domain: 'initech.example' });
    const event = await localEvent(user.id);
    await prisma.calendarEventCustomer.create({
      data: { calendarEventId: event.id, customerId: customer.id },
    });

    const { data } = await calendarService.findAll({}, user.id);

    // The event card shows the company logo and name; without the include the
    // list renders every meeting as unattributed.
    expect(data[0].customers.map((c) => c.customer.name)).toEqual(['Initech']);
  });
});

describe('calendarService.findById', () => {
  it('returns the event with its linked companies', async () => {
    const user = await createUser();
    const customer = await createCustomer(user.id, { name: 'Initech', domain: 'initech.example' });
    const event = await localEvent(user.id, { title: 'Quarterly review' });
    await prisma.calendarEventCustomer.create({
      data: { calendarEventId: event.id, customerId: customer.id },
    });

    const found = await calendarService.findById(event.id, user.id);

    expect(found.title).toBe('Quarterly review');
    expect(found.customers.map((c) => c.customer.name)).toEqual(['Initech']);
  });

  it('404s on another account event — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobEvent = await localEvent(bob.id, { title: 'Board meeting' });

    // Event ids are handed out in URLs. Without the userId in the where, anyone
    // holding an id reads the title, description, location and attendee list of
    // a meeting that is not theirs.
    await expect(calendarService.findById(bobEvent.id, alice.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('404s on an unknown id', async () => {
    const user = await createUser();
    await expect(
      calendarService.findById('11111111-1111-1111-1111-111111111111', user.id)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('calendarService.create', () => {
  it('stores the event against the calling account', async () => {
    const { alice, bob } = await createTwoUsers();

    const { event: created } = await calendarService.create(
      {
        title: 'Design review',
        description: 'Go through the mocks',
        startTime: '2026-08-20T09:00:00.000Z',
        endTime: '2026-08-20T10:00:00.000Z',
        location: 'Room 3',
        colorId: '5',
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'],
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
        visibility: 'private',
      },
      alice.id
    );

    expect(created.userId).toBe(alice.id);
    expect(created.title).toBe('Design review');
    expect(created.startTime.toISOString()).toBe('2026-08-20T09:00:00.000Z');
    expect(created.colorId).toBe('5');
    expect(created.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO']);
    expect(created.visibility).toBe('private');
    expect(created.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] });

    // And it belongs to nobody else.
    const { data } = await calendarService.findAll({}, bob.id);
    expect(data).toEqual([]);
  });

  it('still creates the event when Google is not connected', async () => {
    const user = await createUser();

    const { event: created } = await calendarService.create(
      { title: 'Solo block', startTime: '2026-08-20T09:00:00.000Z', endTime: '2026-08-20T10:00:00.000Z' },
      user.id
    );

    // A user who has not connected Google — or whose grant lapsed — must still
    // be able to put something in their own calendar.
    expect(created.googleEventId).toBeNull();
    expect(calendar.eventsInsert).not.toHaveBeenCalled();
  });

  it('records what Google returns for the event it created', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    calendar.eventsInsert.mockResolvedValue({
      data: {
        id: 'google-event-1',
        hangoutLink: 'https://meet.google.com/abc-defg-hij',
        attendees: [{ email: 'guest@example.com', responseStatus: 'needsAction' }],
      },
    });

    const { event: created } = await calendarService.create(
      {
        title: 'Kickoff',
        startTime: '2026-08-20T09:00:00.000Z',
        endTime: '2026-08-20T10:00:00.000Z',
        attendees: [{ email: 'guest@example.com' }],
        addGoogleMeet: true,
      },
      user.id
    );

    // Without the id written back, the row is orphaned: every later edit,
    // delete and RSVP has nothing to address on Google, and the next sync
    // imports the same meeting again as a second event.
    expect(created.googleEventId).toBe('google-event-1');
    expect(created.conferenceLink).toBe('https://meet.google.com/abc-defg-hij');
    expect(created.syncedAt).not.toBeNull();
  });
});

describe('calendarService — clearing a field actually clears it', () => {
  /**
   * Emptying the description or location box used to be a silent no-op: the
   * modal sent `value || undefined`, JSON.stringify dropped the key, and the
   * `!== undefined` guard below correctly read that as "leave alone". The
   * modal now always sends the key, which makes these two things load-bearing:
   * '' has to become NULL, and an OMITTED key still has to mean "leave alone".
   *
   * `toBeNull()`, never `toBeFalsy()` — '' is falsy too, and storing '' beside
   * the NULLs the Google sync writes is the defect, not the fix.
   */
  it('stores NULL when created with an empty description or location', async () => {
    // The regression the client change would otherwise introduce. Create used
    // to receive `undefined` and write NULL by accident; now it receives ''.
    const user = await createUser();

    const { event: created } = await calendarService.create({
      title: 'Standup',
      description: '',
      location: '',
      startTime: '2026-08-20T09:00:00.000Z',
      endTime: '2026-08-20T09:30:00.000Z',
    }, user.id);

    const row = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.description).toBeNull();
    expect(row.location).toBeNull();
  });

  it('stores NULL when an existing description or location is cleared', async () => {
    const user = await createUser();
    const event = await localEvent(user.id, { description: 'Notes', location: 'Room 3' });

    await calendarService.update(event.id, { description: '', location: '' }, user.id);

    const row = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.description).toBeNull();
    expect(row.location).toBeNull();
  });

  it('sends the cleared value to Google rather than omitting the key', async () => {
    // `events.update` is a full replace, so an omitted key would also clear —
    // but only by accident. This pins the explicit form, which stays correct
    // if the verb ever changes to `events.patch`, where omission means the
    // opposite.
    const user = await createUser();
    await createGoogleAuth(user.id);
    const event = await localEvent(user.id, {
      description: 'Notes',
      location: 'Room 3',
      googleEventId: 'g-1',
    });

    await calendarService.update(event.id, { description: '', location: '' }, user.id);

    await vi.waitFor(() => expect(calendar.eventsUpdate).toHaveBeenCalled());
    const body = calendar.eventsUpdate.mock.calls[0][0].requestBody;
    expect(body.description).toBe('');
    expect(body.location).toBe('');
  });
});

describe('calendarService.update', () => {
  it('applies only the fields provided', async () => {
    const user = await createUser();
    const event = await localEvent(user.id, {
      title: 'Old title',
      description: 'Keep me',
      location: 'Room 3',
    });

    const { event: updated } = await calendarService.update(event.id, { title: 'New title' }, user.id);

    expect(updated.title).toBe('New title');
    // A blanket write of the whole object would clear everything the edit form
    // did not submit.
    expect(updated.description).toBe('Keep me');
    expect(updated.location).toBe('Room 3');
  });

  it('refuses to edit another account event — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobEvent = await localEvent(bob.id, { title: 'Board meeting' });

    await expect(
      calendarService.update(bobEvent.id, { title: 'Cancelled' }, alice.id)
      // 404 like findById/delete/respond, not merely "threw". Without the
      // ownership pre-check this raised a raw Prisma P2025 with no `.status`,
      // which the error handler could only render as a 500 — a bare toThrow()
      // could not tell the two apart.
    ).rejects.toMatchObject({ status: 404 });

    const untouched = await prisma.calendarEvent.findUnique({ where: { id: bobEvent.id } });
    expect(untouched!.title).toBe('Board meeting');
  });

  it('ignores a recurrence change made from a single instance of a series', async () => {
    const user = await createUser();
    const instance = await localEvent(user.id, {
      recurringEventId: 'series-1',
      recurrence: ['RRULE:FREQ=DAILY'],
    });

    const { event: updated } = await calendarService.update(
      instance.id,
      { title: 'Renamed', recurrence: ['RRULE:FREQ=WEEKLY'] },
      user.id
    );

    // The rule lives on the master event; an instance only carries a copy.
    // Writing it here would put the row out of step with Google, which rejects
    // the change anyway, and the next sync would flip it back.
    expect(updated.title).toBe('Renamed');
    expect(updated.recurrence).toEqual(['RRULE:FREQ=DAILY']);
  });

  it('applies a recurrence change made on the master event', async () => {
    const user = await createUser();
    const master = await localEvent(user.id, { recurrence: ['RRULE:FREQ=DAILY'] });

    const { event: updated } = await calendarService.update(
      master.id,
      { recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'] },
      user.id
    );

    expect(updated.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO']);
  });
});

describe('calendarService.delete', () => {
  it('removes the event and leaves the account other events alone', async () => {
    const user = await createUser();
    const doomed = await localEvent(user.id, { title: 'Doomed' });
    const keeper = await localEvent(user.id, { title: 'Keeper' });

    await calendarService.delete(doomed.id, user.id);

    expect(await prisma.calendarEvent.findUnique({ where: { id: doomed.id } })).toBeNull();
    expect(await prisma.calendarEvent.findUnique({ where: { id: keeper.id } })).not.toBeNull();
  });

  it('404s on another account event and leaves it in place — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobEvent = await localEvent(bob.id);

    await expect(calendarService.delete(bobEvent.id, alice.id)).rejects.toMatchObject({
      status: 404,
    });

    expect(await prisma.calendarEvent.findUnique({ where: { id: bobEvent.id } })).not.toBeNull();
  });

  it('deletes every local instance of the series in mode all', async () => {
    const user = await createUser();
    const first = await localEvent(user.id, {
      recurringEventId: 'series-1',
      startTime: new Date('2026-08-20T09:00:00.000Z'),
    });
    const second = await localEvent(user.id, {
      recurringEventId: 'series-1',
      startTime: new Date('2026-08-27T09:00:00.000Z'),
    });
    const unrelated = await localEvent(user.id, { title: 'One-off' });

    await calendarService.delete(first.id, user.id, 'all');

    expect(await prisma.calendarEvent.findUnique({ where: { id: first.id } })).toBeNull();
    // "Delete all events in the series" has to reach the instances the user
    // never opened, not just the one they clicked.
    expect(await prisma.calendarEvent.findUnique({ where: { id: second.id } })).toBeNull();
    expect(await prisma.calendarEvent.findUnique({ where: { id: unrelated.id } })).not.toBeNull();
  });

  it('does not delete another account copy of the same series — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    // Both were invited to the same weekly meeting, so both hold rows carrying
    // Google's series id. It is a shared identifier, not a private one: an
    // unscoped deleteMany on it wipes the other guest's calendar too.
    const aliceInstance = await localEvent(alice.id, { recurringEventId: 'shared-series' });
    const bobInstance = await localEvent(bob.id, { recurringEventId: 'shared-series' });
    const bobSecond = await localEvent(bob.id, {
      recurringEventId: 'shared-series',
      startTime: new Date('2026-08-27T09:00:00.000Z'),
    });

    await calendarService.delete(aliceInstance.id, alice.id, 'all');

    expect(await prisma.calendarEvent.findUnique({ where: { id: aliceInstance.id } })).toBeNull();
    expect(await prisma.calendarEvent.findUnique({ where: { id: bobInstance.id } })).not.toBeNull();
    expect(await prisma.calendarEvent.findUnique({ where: { id: bobSecond.id } })).not.toBeNull();
  });

  it('deletes just the one event when mode all is asked of a non-recurring event', async () => {
    const user = await createUser();
    const single = await localEvent(user.id, { title: 'One-off' });
    const other = await localEvent(user.id, { title: 'Another' });

    await calendarService.delete(single.id, user.id, 'all');

    expect(await prisma.calendarEvent.findUnique({ where: { id: single.id } })).toBeNull();
    expect(await prisma.calendarEvent.findUnique({ where: { id: other.id } })).not.toBeNull();
  });

  it('deletes the series on Google, not the single instance', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    const instance = await localEvent(user.id, {
      googleEventId: 'instance-id',
      recurringEventId: 'series-id',
    });

    await calendarService.delete(instance.id, user.id, 'all');

    // Sending the instance id here deletes one occurrence on Google while the
    // whole series disappears locally — and the next sync re-imports it all.
    // The whole argument, not just the eventId: a wrong `calendarId` is
    // swallowed by the surrounding try/catch, so objectContaining left the
    // local rows deleted and the Google event alive, to be re-imported on the
    // next sync — exactly the outcome this test names.
    expect(calendar.eventsDelete).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'series-id',
    });
  });

  it('deletes a single event on Google too', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    const event = await localEvent(user.id, { googleEventId: 'instance-id' });

    await calendarService.delete(event.id, user.id);

    expect(calendar.eventsDelete).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'instance-id',
    });
  });
});

describe('calendarService.respond', () => {
  it('404s on another account event and makes no Google call — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    await createGoogleAuth(alice.id);
    const bobEvent = await localEvent(bob.id, { googleEventId: 'bobs-google-event' });

    await expect(calendarService.respond(bobEvent.id, 'declined', alice.id)).rejects.toMatchObject({
      status: 404,
    });

    // Without the ownership check this patches Bob's event on Google using
    // Alice's credentials — a write to somebody else's calendar, not just a read.
    expect(eventsPatch).not.toHaveBeenCalled();
  });

  it('400s for an event Google has never seen', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    const local = await localEvent(user.id, { googleEventId: null });

    await expect(calendarService.respond(local.id, 'accepted', user.id)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('400s when Google is not connected', async () => {
    const user = await createUser();
    const event = await localEvent(user.id, { googleEventId: 'g-1' });

    await expect(calendarService.respond(event.id, 'accepted', user.id)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('changes only the caller own attendee entry and stores what Google returns', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    const event = await localEvent(user.id, { googleEventId: 'g-1' });

    calendar.eventsGet.mockResolvedValue({
      data: {
        id: 'g-1',
        attendees: [
          { email: 'me@example.com', self: true, responseStatus: 'needsAction' },
          { email: 'organiser@example.com', organizer: true, responseStatus: 'accepted' },
        ],
      },
    });
    eventsPatch.mockResolvedValue({
      data: {
        id: 'g-1',
        attendees: [
          { email: 'me@example.com', self: true, responseStatus: 'declined' },
          { email: 'organiser@example.com', organizer: true, responseStatus: 'accepted' },
        ],
      },
    });

    const updated = await calendarService.respond(event.id, 'declined', user.id);

    const [args] = eventsPatch.mock.calls[0] as [calendar_v3.Params$Resource$Events$Patch];
    expect(args.eventId).toBe('g-1');
    const sent = args.requestBody!.attendees!;
    // events.patch replaces the attendee list wholesale, so the other guests
    // have to be echoed back untouched — rewriting their responseStatus would
    // silently re-RSVP for them.
    expect(sent).toEqual([
      { email: 'me@example.com', self: true, responseStatus: 'declined' },
      { email: 'organiser@example.com', organizer: true, responseStatus: 'accepted' },
    ]);

    const stored = updated.attendees as unknown as Array<{ email: string; responseStatus: string }>;
    expect(stored).toEqual([
      expect.objectContaining({ email: 'me@example.com', responseStatus: 'declined' }),
      expect.objectContaining({ email: 'organiser@example.com', responseStatus: 'accepted' }),
    ]);
    expect(updated.syncedAt).not.toBeNull();
  });
});

describe('calendarService — a push to Google that fails is reported, not swallowed', () => {
  /**
   * `pushToGoogle` used to return `undefined` from five places for four
   * different reasons, and swallow every Google error into a `console.error`.
   * So the request answered 201/200 whether the change reached Google or not,
   * and the user was told "Event created" over a divergence they could not see.
   *
   * The two silences are not the same and must not be conflated: a user with no
   * Google account connected is working locally on purpose, and must never be
   * warned. Only a real failure does.
   */
  it('reports a rate limit as retryable, and keeps the local event', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    calendar.eventsInsert.mockRejectedValueOnce({ code: 429 });

    const { event, push } = await calendarService.create({
      title: 'Standup',
      startTime: '2026-08-20T09:00:00.000Z',
      endTime: '2026-08-20T09:30:00.000Z',
    }, user.id);

    expect(push.status).toBe('failed');
    expect(push.status === 'failed' && push.failure.code).toBe('rate_limited');
    expect(push.status === 'failed' && push.failure.retryable).toBe(true);
    // The write is real. Rolling it back would be worse than the divergence:
    // the user would be told nothing saved when the row exists.
    const row = await prisma.calendarEvent.findUnique({ where: { id: event.id } });
    expect(row).not.toBeNull();
    expect(row?.googleEventId).toBeNull();
  });

  it('stays silent for a user who has not connected Google', async () => {
    // The guard on the whole design. `skipped` must never look like `failed`.
    const user = await createUser();

    const { push } = await calendarService.create({
      title: 'Local only',
      startTime: '2026-08-20T09:00:00.000Z',
      endTime: '2026-08-20T09:30:00.000Z',
    }, user.id);

    expect(push.status).toBe('skipped');
    expect(push.status === 'skipped' && push.reason).toBe('not-connected');
    expect(calendar.eventsInsert).not.toHaveBeenCalled();
  });

  it('keeps an edit that Google refused, and says it is not worth retrying', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    const event = await localEvent(user.id, { title: 'Before', googleEventId: 'g-1' });
    calendar.eventsUpdate.mockRejectedValueOnce({
      response: { status: 403 },
      errors: [{ reason: 'insufficientPermissions' }],
    });

    const { push } = await calendarService.update(event.id, { title: 'After' }, user.id);

    const row = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.title).toBe('After');
    expect(push.status === 'failed' && push.failure.retryable).toBe(false);
  });

  it('refuses to delete locally when Google could not be told', async () => {
    // Delete is the one verb where the push runs FIRST, so a failure can abort
    // it and leave both sides agreeing. 502 rather than Google's own status: a
    // propagated 401 would log the user out of Mailviz over a lapsed Google
    // grant, and its session is fine.
    const user = await createUser();
    await createGoogleAuth(user.id);
    const event = await localEvent(user.id, { title: 'Keep me', googleEventId: 'g-1' });
    calendar.eventsDelete.mockRejectedValueOnce({ code: 500 });

    const err = await calendarService
      .delete(event.id, user.id)
      .then(() => null)
      .catch((e: { status?: number }) => e);

    expect(err?.status).toBe(502);
    const row = await prisma.calendarEvent.findUnique({ where: { id: event.id } });
    expect(row).not.toBeNull();
  });

  it('treats an event already gone from Google as deleted', async () => {
    // Otherwise a row whose Google event was removed in Google's own UI can
    // never be deleted here: every attempt repeats the same 404.
    const user = await createUser();
    await createGoogleAuth(user.id);
    const event = await localEvent(user.id, { googleEventId: 'g-1' });
    calendar.eventsDelete.mockRejectedValueOnce({ code: 404 });

    await calendarService.delete(event.id, user.id);

    const row = await prisma.calendarEvent.findUnique({ where: { id: event.id } });
    expect(row).toBeNull();
  });

  it('reads a status carried only on response.status', async () => {
    // Gaxios puts it on `code`, `status`, or `response.status`. This service
    // checked only the first, which is why the shared helper moved out of
    // gmailLimiter rather than being written again here.
    const user = await createUser();
    await createGoogleAuth(user.id);
    const event = await localEvent(user.id, { googleEventId: 'g-1' });
    calendar.eventsDelete.mockRejectedValueOnce({ response: { status: 410 } });

    await calendarService.delete(event.id, user.id);

    const row = await prisma.calendarEvent.findUnique({ where: { id: event.id } });
    expect(row).toBeNull();
  });
});

