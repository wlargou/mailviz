import { z } from 'zod';

export const convertToTaskSchema = z.object({
  title: z.string().max(255).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  notes: z.string().max(2000).optional(),
});

export type ConvertToTaskInput = z.infer<typeof convertToTaskSchema>;
