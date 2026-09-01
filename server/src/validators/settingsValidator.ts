import { z } from 'zod';

/**
 * A3: Shared Zod validators for settings entities (TaskStatus, CompanyCategory).
 * Replaces inline typeof checks in controllers with proper Zod validation.
 */

export const createSettingsItemSchema = z.object({
  // `.trim()` before the length checks, not a trailing `.transform`: trimming
  // last means '   ' satisfies min(1) and is then stored as an empty label — a
  // Kanban column with no visible name.
  label: z.string().trim().min(1, 'Label is required').max(100, 'Label too long'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color').optional().default('#4589ff'),
});

export const updateSettingsItemSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(100, 'Label too long').optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color').optional(),
});

/**
 * Task statuses carry one field company categories do not: whether the status
 * means the work is finished.
 *
 * Extended rather than added to the shared schemas, so a company category
 * cannot accept an `isTerminal` that nothing would ever read.
 *
 * `isTerminal` is declared without a default on the update schema on purpose.
 * A `.default()` on an optional field still applies when the field is absent —
 * the trap `updateDealSchema` fell into, where every PATCH silently reset a
 * field the caller never mentioned. Absent here means "leave it alone".
 */
export const createTaskStatusSchema = createSettingsItemSchema.extend({
  isTerminal: z.boolean().optional().default(false),
});

export const updateTaskStatusSchema = updateSettingsItemSchema.extend({
  isTerminal: z.boolean().optional(),
});

export const reorderSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    position: z.number().int().min(0),
  })),
});

export type CreateSettingsItemInput = z.infer<typeof createSettingsItemSchema>;
export type UpdateSettingsItemInput = z.infer<typeof updateSettingsItemSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
