import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventModal } from './EventModal';
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
