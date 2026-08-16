export interface EventAttendee {
  email: string;
  displayName: string | null;
  responseStatus: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  self: boolean;
  organizer: boolean;
}

export type ReminderMethod = 'email' | 'popup';

export interface EventReminderOverride {
  method: ReminderMethod;
  /** Minutes before the event start. Google caps this at 40320 (4 weeks). */
  minutes: number;
}

export interface EventReminders {
  useDefault: boolean;
  /** Google allows at most 5 overrides, and only when useDefault is false. */
  overrides?: EventReminderOverride[];
}

export type EventVisibility = 'default' | 'public' | 'private' | 'confidential';

export interface CalendarEvent {
  id: string;
  googleEventId: string | null;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  location: string | null;
  isAllDay: boolean;
  calendarId: string | null;
  colorId: string | null;
  attendees: EventAttendee[] | null;
  conferenceLink: string | null;
  recurringEventId: string | null;
  recurrence: string[];
  reminders: EventReminders | null;
  visibility: EventVisibility | null;
  customers?: Array<{ customer: { id: string; name: string; domain: string | null; logoUrl: string | null } }>;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  location?: string;
  isAllDay?: boolean;
  attendees?: Array<{ email: string }>;
  sendUpdates?: 'all' | 'none';
  addGoogleMeet?: boolean;
  colorId?: string;
  /** RFC 5545 recurrence lines, e.g. ['RRULE:FREQ=WEEKLY;BYDAY=MO']. Empty array clears the rule. */
  recurrence?: string[];
  reminders?: EventReminders;
  visibility?: EventVisibility;
}

export interface UpdateEventInput extends Partial<CreateEventInput> {}

export interface GoogleStatus {
  connected: boolean;
  email?: string;
  lastSyncAt?: string;
  lastMailSyncAt?: string;
  needsReauth?: boolean;
}

export type CalendarViewMode = 'month' | 'week' | 'day';
