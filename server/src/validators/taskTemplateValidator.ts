import { z } from 'zod';
import { TASK_LINK_TYPES } from './taskValidator.js';

/**
 * The tree a task template stores.
 *
 * Two levels, like tasks themselves: an item may carry subtasks, a subtask
 * may not. Due dates are offsets in days from the anchor the template is
 * applied against, so "a week after kickoff" survives being reused.
 */
const leafSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  estimatedMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  /** Days after the anchor; negative means before. Absent = no due date. */
  dueOffsetDays: z.number().int().min(-365).max(365).nullable().optional(),
  labelIds: z.array(z.string().uuid()).max(20).optional(),
  checklist: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
});

export const templateItemSchema = leafSchema.extend({
  subtasks: z.array(leafSchema).max(50).optional(),
});

export const createTaskTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  items: z.array(templateItemSchema).min(1).max(100),
});

export const updateTaskTemplateSchema = createTaskTemplateSchema.partial();

/** Turn an existing task, with its subtasks and checklist, into a template. */
export const templateFromTaskSchema = z.object({
  taskId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
});

export const instantiateTemplateSchema = z.object({
  /** Day zero for the offsets. Defaults to now. */
  anchorDate: z.string().datetime().optional(),
  customerId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  /** Records every created top-level task is attached to. */
  links: z
    .array(z.object({ entityType: z.enum(TASK_LINK_TYPES), entityId: z.string().uuid() }))
    .max(5)
    .optional(),
});

export type TemplateLeaf = z.infer<typeof leafSchema>;
export type TemplateItem = z.infer<typeof templateItemSchema>;
export type CreateTaskTemplateInput = z.infer<typeof createTaskTemplateSchema>;
export type UpdateTaskTemplateInput = z.infer<typeof updateTaskTemplateSchema>;
export type TemplateFromTaskInput = z.infer<typeof templateFromTaskSchema>;
export type InstantiateTemplateInput = z.infer<typeof instantiateTemplateSchema>;
