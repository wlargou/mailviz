import { z } from 'zod';
import { createTaskSchema } from './taskValidator.js';

export const attachToTaskSchema = z.object({
  taskId: z.string().uuid(),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Everything a task can be created with, plus the conversion note.
 *
 * This used to accept title, priority and notes and nothing else, so the
 * convert form could not set a due date, labels, company or estimate — the
 * user had to convert and then open the task to finish it. Built from
 * `createTaskSchema` so the two forms cannot drift apart again.
 *
 * `title` is optional here where the task schema requires it: the service
 * falls back to the email's subject. `parentId` is omitted — a task made from
 * an email is never a subtask. Safe to `.extend` over: `createTaskSchema` has
 * no `.default()` anywhere, so nothing is silently reintroduced on an absent
 * key (the `updateDealSchema` gotcha).
 */
export const convertToTaskSchema = createTaskSchema
  .omit({ parentId: true })
  .extend({
    title: z.string().max(255).optional(),
    notes: z.string().max(2000).optional(),
  });

export type ConvertToTaskInput = z.infer<typeof convertToTaskSchema>;
