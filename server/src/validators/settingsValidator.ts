import { z } from 'zod';

/**
 * A3: Shared Zod validators for settings entities (TaskStatus, CompanyCategory).
 * Replaces inline typeof checks in controllers with proper Zod validation.
 */

export const createSettingsItemSchema = z.object({
  label: z.string().min(1, 'Label is required').max(100, 'Label too long').transform((s) => s.trim()),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color').optional().default('#4589ff'),
});

export const updateSettingsItemSchema = z.object({
  label: z.string().min(1, 'Label is required').max(100, 'Label too long').transform((s) => s.trim()).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color').optional(),
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
