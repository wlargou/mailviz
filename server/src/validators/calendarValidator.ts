import { z } from 'zod';

// RFC 5545 recurrence lines as Google Calendar expects them, e.g.
//   "RRULE:FREQ=WEEKLY;BYDAY=MO"
//   "EXDATE;TZID=Europe/Paris:20260101T090000"
// Shape check only — we do not attempt to validate the rule semantics, but we
// refuse anything that isn't a recognised property name followed by a value
// made of the characters RFC 5545 allows in these lines.
const RECURRENCE_LINE = /^(RRULE|EXRULE|RDATE|EXDATE)[;:][A-Za-z0-9;:=,\-+/._]+$/;

export const recurrenceSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(512)
      .regex(RECURRENCE_LINE, 'Must be an RFC 5545 recurrence line (e.g. "RRULE:FREQ=WEEKLY;BYDAY=MO")'),
  )
  .max(10);

// Google Calendar reminder overrides. Google rejects more than 5 overrides per
// event and caps `minutes` at 40320 (4 weeks before the start time).
const MAX_REMINDER_OVERRIDES = 5;
const MAX_REMINDER_MINUTES = 40320;

export const reminderOverrideSchema = z.object({
  method: z.enum(['email', 'popup']),
  minutes: z.number().int().min(0).max(MAX_REMINDER_MINUTES),
});

export const remindersSchema = z
  .object({
    useDefault: z.boolean(),
    overrides: z.array(reminderOverrideSchema).max(MAX_REMINDER_OVERRIDES).optional(),
  })
  // Google requires useDefault:false whenever explicit overrides are supplied —
  // the two are mutually exclusive, and sending both is a 400.
  .refine((r) => !(r.useDefault && r.overrides && r.overrides.length > 0), {
    message: 'useDefault must be false when reminder overrides are provided',
    path: ['useDefault'],
  });

export const visibilitySchema = z.enum(['default', 'public', 'private', 'confidential']);

export const createEventSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().trim().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  location: z.string().trim().optional(),
  isAllDay: z.boolean().optional(),
  attendees: z.array(z.object({
    email: z.string().email(),
  })).optional(),
  sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('all'),
  addGoogleMeet: z.boolean().optional(),
  colorId: z.string().max(2).optional(),
  recurrence: recurrenceSchema.optional(),
  reminders: remindersSchema.optional(),
  visibility: visibilitySchema.optional(),
});

export const updateEventSchema = createEventSchema.partial();

export const respondEventSchema = z.object({
  response: z.enum(['accepted', 'declined', 'tentative']),
});

export type EventReminders = z.infer<typeof remindersSchema>;
export type EventVisibility = z.infer<typeof visibilitySchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type RespondEventInput = z.infer<typeof respondEventSchema>;
