import { z } from 'zod';
import { TASK_RRULE_PATTERN } from '../utils/recurrence.js';

export const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().trim().optional(),
  status: z.string().trim().min(1).max(100).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  /** When work can begin. Never after the due date — the service checks the pair. */
  startDate: z.string().datetime().nullable().optional(),
  /** When to raise a reminder notification. Fires once. */
  remindAt: z.string().datetime().nullable().optional(),
  labelIds: z.array(z.string().uuid()).optional(),
  customerId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  estimatedMinutes: z.number().int().min(0).nullable().optional(),
  /** Makes the task a subtask of another. `null` detaches it. */
  parentId: z.string().uuid().nullable().optional(),
  /**
   * One RRULE line, from the shared presets. Finishing the task creates the
   * next occurrence from it; that needs a due date to advance, which the
   * service checks against the row (a PATCH may carry one without the other).
   */
  recurrence: z.string().regex(TASK_RRULE_PATTERN, 'Must be a supported RRULE').nullable().optional(),
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  /**
   * Finish a task that still has unfinished blockers. Off by default: the
   * gate is the point of a dependency, and overriding it is a decision the
   * user takes in the UI, not a default a caller inherits.
   */
  force: z.boolean().optional(),
});

export const TASK_LINK_TYPES = ['contact', 'deal', 'event'] as const;
export type TaskLinkType = (typeof TASK_LINK_TYPES)[number];

export const addLinkSchema = z.object({
  entityType: z.enum(TASK_LINK_TYPES),
  entityId: z.string().uuid(),
});

export const addDependencySchema = z.object({
  blockerId: z.string().uuid(),
});

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

/**
 * A comment. `mentions` are user ids the client resolved from the @names in
 * the body; the server checks they are real users and drops the author.
 */
export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  mentions: z.array(z.string().uuid()).max(20).optional(),
});

export const updateCommentSchema = createCommentSchema;

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;
export type CommentInput = z.infer<typeof createCommentSchema>;
