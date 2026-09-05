import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().trim().optional(),
  status: z.string().trim().min(1).max(100).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  labelIds: z.array(z.string().uuid()).optional(),
  customerId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  estimatedMinutes: z.number().int().min(0).nullable().optional(),
  /** Makes the task a subtask of another. `null` detaches it. */
  parentId: z.string().uuid().nullable().optional(),
});

export const updateTaskSchema = createTaskSchema.partial();

export const reorderSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      status: z.string().trim().min(1).max(100),
      position: z.number().int().min(0),
    })
  ),
});

// `.trim()` before `.min()`, so a line of spaces is rejected rather than
// stored as ''.
export const createChecklistItemSchema = z.object({
  text: z.string().trim().min(1).max(500),
});

export const updateChecklistItemSchema = z
  .object({
    text: z.string().trim().min(1).max(500).optional(),
    isDone: z.boolean().optional(),
  })
  .refine((v) => v.text !== undefined || v.isDone !== undefined, {
    message: 'Nothing to update',
  });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;
