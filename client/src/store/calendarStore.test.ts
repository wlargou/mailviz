import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WEEK_STARTS_ON } from '../utils/week';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import {
  addMonths,
  endOfMonth,
  getDay,
  startOfDay,
  endOfDay,
  startOfMonth,
  addWeeks,
  addDays,
  startOfWeek,
  isSameDay,
} from 'date-fns';
import { calendarApi } from '../api/calendar';
import { authApi } from '../api/auth';
import { useCalendarStore } from './calendarStore';
import type { CalendarEvent, GoogleStatus } from '../types/calendar';

/**
 * The calendar store.
 *
 * Every navigation action here does two things — move `currentDate`/`viewMode`,
 * then refetch — and the refetch reads the range back out of the store. So the
 * bug this file is really guarding is an off-by-one-step fetch: click "next
 * month" and get the month you just left, because the fetch was issued before
 * the state moved. The window itself matters too: a month grid renders the
 * trailing days of the previous month and the leading days of the next one, so
 * a fetch bounded by the month alone leaves those cells silently empty.
 */

vi.mock('../api/calendar', () => ({
  calendarApi: {
    getAll: vi.fn(),
    sync: vi.fn(),
  },
}));

vi.mock('../api/auth', () => ({
  authApi: {
    getGoogleStatus: vi.fn(),
  },
}));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    googleEventId: null,
    title: 'Standup',
    description: null,
    startTime: '2026-03-15T09:00:00.000Z',
    endTime: '2026-03-15T09:30:00.000Z',
    location: null,
    isAllDay: false,
    calendarId: null,
    colorId: null,
    attendees: null,
    conferenceLink: null,
    recurringEventId: null,
    recurrence: [],
    reminders: null,
    visibility: null,
    syncedAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockEvents(events: CalendarEvent[]) {
  vi.mocked(calendarApi.getAll).mockResolvedValue(axiosOk({ data: events }));
}

/** The [start, end) window of the most recent GET /calendar, as Dates. */
function lastRange(): { start: Date; end: Date } {
  const calls = vi.mocked(calendarApi.getAll).mock.calls;
  const [start, end] = calls[calls.length - 1];
  return { start: new Date(start), end: new Date(end) };
}

/** A Sunday-in-the-middle-of-a-month anchor, so week and month views differ. */
const anchor = new Date(2026, 2, 15, 12, 0, 0); // 15 Mar 2026

/** Captured before any test mutates it; `setState(_, true)` replaces actions too. */
const initialState = useCalendarStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useCalendarStore.setState(initialState, true);
  mockEvents([]);
});

describe('calendarStore', () => {
  it('starts on the month view with nothing loaded', () => {
    const state = useCalendarStore.getState();

    expect(state.events).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.syncing).toBe(false);
    expect(state.viewMode).toBe('month');
    expect(state.googleStatus).toBeNull();
  });

  it('fetches the whole month grid, not just the month', async () => {
    useCalendarStore.setState({ currentDate: anchor, viewMode: 'month' });
    const event = makeEvent();
    mockEvents([event]);

    await useCalendarStore.getState().fetchEvents();

    const { start, end } = lastRange();
    // The grid covers the leading and trailing days of the neighbouring months
    // that the month view still draws. Bounding the query by
    // startOfMonth/endOfMonth leaves those cells empty even though the events
    // exist — and bounding it on the WRONG week start leaves a whole column
    // empty, which is what this used to assert.
    expect(getDay(start)).toBe(WEEK_STARTS_ON);
    expect(getDay(end)).toBe((WEEK_STARTS_ON + 6) % 7);
    expect(start.getTime()).toBeLessThanOrEqual(startOfMonth(anchor).getTime());
    expect(end.getTime()).toBeGreaterThanOrEqual(endOfMonth(anchor).getTime());
    expect(useCalendarStore.getState().events).toEqual([event]);
  });

  it('fetches exactly one day in day view', async () => {
    useCalendarStore.setState({ currentDate: anchor, viewMode: 'day' });

    await useCalendarStore.getState().fetchEvents();

    const { start, end } = lastRange();
    expect(start.getTime()).toBe(startOfDay(anchor).getTime());
    expect(end.getTime()).toBe(endOfDay(anchor).getTime());
  });

  it('fetches the same week the week view draws — REGRESSION', async () => {
    // This test used to assert Sunday-to-Saturday, matching what the store did.
    // The views render Monday-to-Sunday. So the assertion described the
    // implementation rather than the requirement, passed, and the app shipped
    // with the rendered Sunday column permanently empty — it sat outside the
    // fetched window — while a fetched Sunday was never drawn.
    //
    // The requirement is that the window covers the grid, so that is what is
    // asserted: every day the week view renders must fall inside the range.
    useCalendarStore.setState({ currentDate: anchor, viewMode: 'week' });

    await useCalendarStore.getState().fetchEvents();

    const { start, end } = lastRange();
    const renderedStart = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON });

    for (let i = 0; i < 7; i++) {
      const day = addDays(renderedStart, i);
      expect(day.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(day.getTime()).toBeLessThanOrEqual(end.getTime());
    }
    // Seven days, not the surrounding month.
    expect(end.getTime() - start.getTime()).toBeLessThan(7 * 24 * 60 * 60 * 1000);
  });

  it('refetches for the NEW view mode when it changes', async () => {
    useCalendarStore.setState({ currentDate: anchor, viewMode: 'month' });

    useCalendarStore.getState().setViewMode('day');
    await vi.waitFor(() => expect(calendarApi.getAll).toHaveBeenCalled());

    const { start, end } = lastRange();
    // The refetch reads viewMode back out of the store, so it has to run after
    // the state has moved. Fetching first gives the day view a month of events
    // — visibly wrong, and it never self-corrects until the next navigation.
    expect(start.getTime()).toBe(startOfDay(anchor).getTime());
    expect(end.getTime()).toBe(endOfDay(anchor).getTime());
    expect(useCalendarStore.getState().viewMode).toBe('day');
  });

  it('navigates a month at a time in month view and fetches the month it landed on', async () => {
    useCalendarStore.setState({ currentDate: anchor, viewMode: 'month' });
    const next = addMonths(anchor, 1);

    useCalendarStore.getState().navigate('next');
    await vi.waitFor(() => expect(calendarApi.getAll).toHaveBeenCalled());

    expect(isSameDay(useCalendarStore.getState().currentDate, next)).toBe(true);
    const { start, end } = lastRange();
    // Same ordering hazard as setViewMode: fetching before the date moves shows
    // April's header over March's events.
    expect(start.getTime()).toBeLessThanOrEqual(startOfMonth(next).getTime());
    expect(end.getTime()).toBeGreaterThanOrEqual(endOfMonth(next).getTime());
  });

  it('navigates by week in week view and by day in day view', () => {
    useCalendarStore.setState({ currentDate: anchor, viewMode: 'week' });
    useCalendarStore.getState().navigate('next');
    // A "next" that jumps a month while the user is looking at a week is the
    // classic version of this bug — the step has to follow the view mode.
    expect(isSameDay(useCalendarStore.getState().currentDate, addWeeks(anchor, 1))).toBe(true);

    useCalendarStore.setState({ currentDate: anchor, viewMode: 'day' });
    useCalendarStore.getState().navigate('prev');
    expect(isSameDay(useCalendarStore.getState().currentDate, addDays(anchor, -1))).toBe(true);
  });

  it('navigate("today") returns to the current date whatever the view', () => {
    useCalendarStore.setState({ currentDate: new Date(2019, 0, 1), viewMode: 'week' });

    useCalendarStore.getState().navigate('today');

    expect(isSameDay(useCalendarStore.getState().currentDate, new Date())).toBe(true);
    // "Today" must not also change the view the user chose.
    expect(useCalendarStore.getState().viewMode).toBe('week');
  });

  it('goToDay switches to the day view and fetches that day', async () => {
    useCalendarStore.setState({ currentDate: anchor, viewMode: 'month' });
    const target = new Date(2026, 5, 9, 8, 0, 0);

    useCalendarStore.getState().goToDay(target);
    await vi.waitFor(() => expect(calendarApi.getAll).toHaveBeenCalled());

    expect(useCalendarStore.getState().viewMode).toBe('day');
    const { start, end } = lastRange();
    // Both the date and the mode have to land before the fetch: clicking a day
    // cell in the month grid otherwise loads a month's worth of events into a
    // single-day column.
    expect(start.getTime()).toBe(startOfDay(target).getTime());
    expect(end.getTime()).toBe(endOfDay(target).getTime());
  });

  it('keeps the events already on screen when a fetch fails', async () => {
    const event = makeEvent();
    mockEvents([event]);
    await useCalendarStore.getState().fetchEvents();

    vi.mocked(calendarApi.getAll).mockRejectedValue(new Error('500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(useCalendarStore.getState().fetchEvents()).resolves.toBeUndefined();

    // A transient failure must not blank the calendar, and must not leave the
    // grid stuck behind its loading state.
    expect(useCalendarStore.getState().events).toEqual([event]);
    expect(useCalendarStore.getState().loading).toBe(false);
  });

  it('a silent refresh never raises the loading flag', async () => {
    let resolve!: (value: AxiosResponse<{ data: CalendarEvent[] }>) => void;
    vi.mocked(calendarApi.getAll).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );

    const pending = useCalendarStore.getState().fetchEvents(true);
    // Silent is what the websocket push and the post-sync refresh use. Flipping
    // `loading` there would blank the grid behind a spinner every time someone
    // else's change arrives.
    expect(useCalendarStore.getState().loading).toBe(false);

    resolve(axiosOk({ data: [] }));
    await pending;
    expect(useCalendarStore.getState().loading).toBe(false);
  });

  it('a normal fetch does raise the loading flag', async () => {
    let resolve!: (value: AxiosResponse<{ data: CalendarEvent[] }>) => void;
    vi.mocked(calendarApi.getAll).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );

    const pending = useCalendarStore.getState().fetchEvents();
    expect(useCalendarStore.getState().loading).toBe(true);

    resolve(axiosOk({ data: [] }));
    await pending;
    expect(useCalendarStore.getState().loading).toBe(false);
  });

  it('sync pulls the new events in and reports how many arrived', async () => {
    const synced = { synced: 3, customersCreated: 1, contactsCreated: 2 };
    vi.mocked(calendarApi.sync).mockResolvedValue(axiosOk({ data: synced }));
    const event = makeEvent();
    mockEvents([event]);

    const result = await useCalendarStore.getState().syncEvents();

    expect(result).toEqual(synced);
    // Syncing writes to the database, not to this store — without the refetch
    // the user clicks "Sync", is told 3 events arrived, and sees none of them.
    expect(calendarApi.getAll).toHaveBeenCalledTimes(1);
    expect(useCalendarStore.getState().events).toEqual([event]);
    expect(useCalendarStore.getState().syncing).toBe(false);
  });

  it('clears the syncing flag when the sync fails', async () => {
    vi.mocked(calendarApi.sync).mockRejectedValue(new Error('Gmail 429'));

    await expect(useCalendarStore.getState().syncEvents()).rejects.toThrow('Gmail 429');

    // The sync button is disabled while `syncing`. Leaving it set after a
    // failure means the only way to retry is a page reload.
    expect(useCalendarStore.getState().syncing).toBe(false);
  });

  it('reports Google as disconnected when the status check fails', async () => {
    const status: GoogleStatus = { connected: true, email: 'alice@example.com' };
    vi.mocked(authApi.getGoogleStatus).mockResolvedValue(axiosOk({ data: status }));
    await useCalendarStore.getState().fetchGoogleStatus();
    expect(useCalendarStore.getState().googleStatus).toEqual(status);

    vi.mocked(authApi.getGoogleStatus).mockRejectedValue(new Error('401'));
    await useCalendarStore.getState().fetchGoogleStatus();

    // null means "not checked yet" and renders nothing; { connected: false } is
    // what puts the "Connect Google Calendar" prompt on screen. Leaving the
    // stale connected:true would show an empty calendar with no explanation.
    expect(useCalendarStore.getState().googleStatus).toEqual({ connected: false });
  });
});
