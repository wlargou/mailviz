import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventModal, shiftedEndDate } from './EventModal';
import { calendarApi } from '../../api/calendar';
import type { CalendarEvent } from '../../types/calendar';

/**
 * Editing an event's guest list.
 *
 * The case worth a test is removing the last attendee. The payload used to send
 * `attendees: undefined` for an empty list, and the update path reads undefined
 * as "leave this field alone" — so the one edit that matters most, uninviting
 * people, was the one edit that silently did nothing. The modal showed an empty
 * list, the save reported success, and everybody stayed invited in Google.
 *
 * Asserted on the payload handed to the API rather than on the rendered chips,
 * because the chips were always right — it was what got sent that was wrong.
 */

vi.mock('../../api/calendar', () => ({
  calendarApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

vi.mock('../../api/contacts', () => ({
  contactsApi: { search: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));

const addNotification = vi.fn();
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: (state: { addNotification: typeof addNotification }) => unknown) =>
    selector({ addNotification }),
}));

const EVENT = {
  id: 'event-1',
  title: 'Quarterly review',
  description: '',
  location: '',
  startTime: '2026-09-10T09:00:00.000Z',
  endTime: '2026-09-10T10:00:00.000Z',
  isAllDay: false,
  // `displayName` and not `name`: this is Google's attendee shape, which is
  // what the modal reads. A fixture using `name` renders the address instead
  // and quietly tests something else.
  attendees: [
    { email: 'jane@acme.test', displayName: 'Jane' },
    { email: 'raj@acme.test', displayName: 'Raj' },
  ],
} as unknown as CalendarEvent;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(calendarApi.update).mockResolvedValue({} as never);
});

function renderModal(event: CalendarEvent | null = EVENT) {
  return render(
    <EventModal open event={event} onClose={vi.fn()} onSaved={vi.fn()} />
  );
}

/** Carbon's filter Tag renders its dismiss control as a button. */
async function removeChip(user: ReturnType<typeof userEvent.setup>, label: string) {
  const chip = await screen.findByText(label);
  const dismiss = chip.closest('.cds--tag')?.querySelector('button');
  expect(dismiss).toBeTruthy();
  await user.click(dismiss as HTMLElement);
}

describe('EventModal — attendees', () => {
  it('sends an empty list when the last attendee is removed', async () => {
    const user = userEvent.setup();
    renderModal();

    await removeChip(user, 'Jane');
    await removeChip(user, 'Raj');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(calendarApi.update).toHaveBeenCalled());
    const [, payload] = vi.mocked(calendarApi.update).mock.calls[0];
    // The whole bug in one assertion: undefined here means "leave them alone".
    expect(payload.attendees).toEqual([]);
    expect(payload.attendees).not.toBeUndefined();
  });

  it('still sends the remaining attendees when only one is removed', async () => {
    const user = userEvent.setup();
    renderModal();

    await removeChip(user, 'Jane');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(calendarApi.update).toHaveBeenCalled());
    const [, payload] = vi.mocked(calendarApi.update).mock.calls[0];
    expect(payload.attendees).toEqual([{ email: 'raj@acme.test' }]);
  });

  it('carries the notification preference on a removal', async () => {
    // sendUpdates used to be gated on a non-empty list too, so the people being
    // uninvited were exactly the people whose notification setting was dropped.
    const user = userEvent.setup();
    renderModal();

    await removeChip(user, 'Jane');
    await removeChip(user, 'Raj');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(calendarApi.update).toHaveBeenCalled());
    const [, payload] = vi.mocked(calendarApi.update).mock.calls[0];
    expect(payload.sendUpdates).toBeDefined();
  });
});

/**
 * Moving a multi-day event's start date must move its end date with it.
 *
 * The caller set the end equal to the new start — offset zero — so a
 * three-day conference dragged forward a week silently became a one-day
 * event. The only field that showed it was the end date, which is exactly the
 * one the user had just stopped looking at.
 */
describe('shiftedEndDate', () => {
  const at = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

  it('keeps a multi-day span when the start moves', () => {
    // 10–12 Sept (2 days apart) dragged to 20 Sept must end on 22 Sept.
    const next = shiftedEndDate('09/10/2026', '09/12/2026', new Date(2026, 8, 20));

    expect(at(next)).toBe('9/22/2026');
  });

  it('keeps a single-day event on one day', () => {
    const next = shiftedEndDate('09/10/2026', '09/10/2026', new Date(2026, 8, 20));

    expect(at(next)).toBe('9/20/2026');
  });

  it('carries the span across a month boundary', () => {
    const next = shiftedEndDate('09/10/2026', '09/13/2026', new Date(2026, 8, 29));

    expect(at(next)).toBe('10/2/2026');
  });

  it('survives a daylight-saving boundary', () => {
    // A span measured in milliseconds is not a whole number of 24-hour days
    // across a DST change, which is what rounding and setDate are for. US DST
    // ends 1 Nov 2026, so this span contains the extra hour.
    const next = shiftedEndDate('10/30/2026', '11/02/2026', new Date(2026, 10, 20));

    expect(at(next)).toBe('11/23/2026');
  });

  it('does not invent a span for a malformed date', () => {
    // parseDateTime falls back to `new Date()` on a bad string, and two such
    // fallbacks are the same instant — so the offset is 0 rather than garbage.
    const next = shiftedEndDate('', '', new Date(2026, 8, 20));

    expect(at(next)).toBe('9/20/2026');
  });
});
