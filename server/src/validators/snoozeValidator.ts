import { z } from 'zod';
import { REMINDER_KINDS } from '../services/snoozeService.js';

/**
 * `remindAt` is validated as a real date here and re-checked against the clock
 * in the service. Both, on purpose: the shape belongs to the schema, and "is it
 * still in the future" is a decision that has to be made at the moment of the
 * write, not at the moment of parsing.
 */
export const createReminderSchema = z.object({
  threadId: z.string().min(1).max(255),
  kind: z.enum(REMINDER_KINDS),
  remindAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'remindAt must be an ISO date-time',
  }),
});

export type CreateReminderInput = z.infer<typeof createReminderSchema>;
