import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createUser, createGoogleAuth } from '../test/factories.js';
import { google, type calendar_v3 } from 'googleapis';
import { createCalendarMock, type CalendarMock } from '../test/calendarMock.js';
import { getCalendarClient } from '../lib/calendar.js';
import { sweepPendingPushes } from './calendarPendingPush.js';

/**
 * The retry that stops `pendingSince` being a freezer.
 *
 * Marking a row pending protects it from the sync, but on its own it only
 * pins it: a push that failed to a thirty-second Google blip would stay
 * diverged until the user happened to re-save. This sweep is the other half,
 * and its risky parts are what it sends rather than whether it runs — a push
 * built from the wrong fields would strip attendees off the Google event and,
 * at the default notification setting, mail everyone about it.
 */

vi.mock('../lib/calendar.js', () => ({ getCalendarClient: vi.fn() }));

let calendar: CalendarMock;

beforeEach(() => {
  vi.clearAllMocks();
  calendar = createCalendarMock();
  // `pushToGoogle` builds `google.calendar({ auth })` inline rather than going
  // through `getCalendarClient`, so both seams need stubbing — otherwise this
  // reaches the real API. Whether Google is "connected" is then decided by the
  // real `getAuthenticatedClient`, i.e. by whether the test made a GoogleAuth
  // row.
  vi.spyOn(google, 'calendar').mockReturnValue(calendar.client as unknown as calendar_v3.Calendar);
  vi.mocked(getCalendarClient).mockResolvedValue(calendar.client as never);
});

const AGO = (ms: number) => new Date(Date.now() - ms);

async function pendingEvent(
  userId: string,
  overrides: Partial<{
    pendingSince: Date;
    googleEventId: string | null;
    title: string;
    attendees: unknown;
  }> = {}
) {
  return prisma.calendarEvent.create({
    data: {
      userId,
      title: overrides.title ?? 'Pending event',
      startTime: new Date('2026-08-20T09:00:00.000Z'),
      endTime: new Date('2026-08-20T10:00:00.000Z'),
      calendarId: 'primary',
      googleEventId: overrides.googleEventId === undefined ? 'g-1' : overrides.googleEventId,
      pendingSince: overrides.pendingSince ?? AGO(5 * 60_000),
      ...(overrides.attendees !== undefined
        ? { attendees: overrides.attendees as never }
        : {}),
    },
  });
}

describe('sweepPendingPushes', () => {
  it('retries a pending row and clears the marker when it lands', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    const event = await pendingEvent(user.id);

    const result = await sweepPendingPushes(user.id);

    expect(result).toEqual({ attempted: 1, cleared: 1 });
    expect(calendar.eventsUpdate).toHaveBeenCalledTimes(1);
    const row = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.pendingSince).toBeNull();
  });

  it('sends the stored attendees, not an empty event', async () => {
    // The most important assertion here. `events.update` is a full replace, so
    // a retry that passed no attendees would silently uninvite everyone — and
    // the request that failed is not around to be read for them.
    const user = await createUser();
    await createGoogleAuth(user.id);
    await pendingEvent(user.id, {
      attendees: [
        { email: 'jane@acme.test', displayName: 'Jane' },
        { email: 'raj@acme.test', displayName: 'Raj' },
      ],
    });

    await sweepPendingPushes(user.id);

    const body = calendar.eventsUpdate.mock.calls[0][0].requestBody;
    expect(body.attendees).toEqual([{ email: 'jane@acme.test' }, { email: 'raj@acme.test' }]);
  });

  it('retries silently', async () => {
    // The user picked a notification setting when they saved and it was not
    // stored. Silent is the only choice that cannot violate it.
    const user = await createUser();
    await createGoogleAuth(user.id);
    await pendingEvent(user.id);

    await sweepPendingPushes(user.id);

    expect(calendar.eventsUpdate.mock.calls[0][0].sendUpdates).toBe('none');
  });

  it('leaves a row that is still being pushed by the request that made it', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    await pendingEvent(user.id, { pendingSince: AGO(10_000) });

    const result = await sweepPendingPushes(user.id);

    expect(result.attempted).toBe(0);
    expect(calendar.eventsUpdate).not.toHaveBeenCalled();
  });

  it('stops retrying a row that has been pending for a day, without clearing it', async () => {
    // It keeps the marker on purpose: clearing would let the next sync destroy
    // the edit, which is the original bug with a delay.
    const user = await createUser();
    await createGoogleAuth(user.id);
    const event = await pendingEvent(user.id, { pendingSince: AGO(25 * 60 * 60_000) });

    const result = await sweepPendingPushes(user.id);

    expect(result.attempted).toBe(0);
    expect(calendar.eventsUpdate).not.toHaveBeenCalled();
    const row = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.pendingSince).not.toBeNull();
  });

  it('creates rather than updates when the original create never landed', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    await pendingEvent(user.id, { googleEventId: null });

    await sweepPendingPushes(user.id);

    expect(calendar.eventsInsert).toHaveBeenCalledTimes(1);
    expect(calendar.eventsUpdate).not.toHaveBeenCalled();
  });

  it('takes the oldest rows first, up to the batch size', async () => {
    // Asserting the id SET, not just the count — a count-only assertion
    // survives losing the ordering, which is the half that matters when more
    // rows are pending than one tick can carry.
    const user = await createUser();
    await createGoogleAuth(user.id);
    const made: Array<{ id: string; age: number }> = [];
    for (let i = 0; i < 25; i++) {
      const age = (2 + i) * 60_000;
      const row = await pendingEvent(user.id, { pendingSince: AGO(age), googleEventId: `g-${i}` });
      made.push({ id: row.id, age });
    }

    const result = await sweepPendingPushes(user.id);

    expect(result.attempted).toBe(20);
    const oldest = made.sort((a, b) => b.age - a.age).slice(0, 20).map((r) => r.id).sort();
    const cleared = await prisma.calendarEvent.findMany({
      where: { userId: user.id, pendingSince: null },
      select: { id: true },
    });
    expect(cleared.map((r) => r.id).sort()).toEqual(oldest);
  });

  it('leaves the marker alone when the retry also fails', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    const pending = AGO(5 * 60_000);
    const event = await pendingEvent(user.id, { pendingSince: pending });
    calendar.eventsUpdate.mockRejectedValueOnce({ code: 500 });

    const result = await sweepPendingPushes(user.id);

    expect(result).toEqual({ attempted: 1, cleared: 0 });
    const row = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.pendingSince).toEqual(pending);
  });
});
