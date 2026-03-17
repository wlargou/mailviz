import { z } from 'zod';

export const createEventSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  location: z.string().optional(),
  isAllDay: z.boolean().optional(),
});

export const updateEventSchema = createEventSchema.partial();

export const respondEventSchema = z.object({
  response: z.enum(['accepted', 'declined', 'tentative']),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type RespondEventInput = z.infer<typeof respondEventSchema>;
