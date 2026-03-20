import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.string().min(1).max(100).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  labelIds: z.array(z.string().uuid()).optional(),
  customerId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  estimatedMinutes: z.number().int().min(0).nullable().optional(),
});

export const updateTaskSchema = createTaskSchema.partial();

export const reorderSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      status: z.string().min(1).max(100),
      position: z.number().int().min(0),
    })
  ),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
