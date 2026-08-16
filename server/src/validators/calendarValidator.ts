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

export const createEventSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  location: z.string().optional(),
  isAllDay: z.boolean().optional(),
  attendees: z.array(z.object({
    email: z.string().email(),
  })).optional(),
  sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('all'),
  addGoogleMeet: z.boolean().optional(),
  colorId: z.string().max(2).optional(),
  recurrence: recurrenceSchema.optional(),
});

export const updateEventSchema = createEventSchema.partial();

export const respondEventSchema = z.object({
  response: z.enum(['accepted', 'declined', 'tentative']),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type RespondEventInput = z.infer<typeof respondEventSchema>;
