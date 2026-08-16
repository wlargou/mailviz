import { z } from 'zod';

export const createContactSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional().or(z.literal('')),
  role: z.string().max(100).optional().or(z.literal('')),
  customerId: z.string().uuid(),
  isVip: z.boolean().optional(),
});

export const updateContactSchema = createContactSchema.omit({ customerId: true }).partial();

/**
 * A merge deletes rows irreversibly, so the caller must name every id it means
 * to destroy. There is no "merge this whole group" shortcut — the client sends
 * exactly what the user confirmed on screen.
 */
export const mergeContactsSchema = z.object({
  targetId: z.string().uuid(),
  sourceIds: z.array(z.string().uuid()).min(1).max(50),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type MergeContactsInput = z.infer<typeof mergeContactsSchema>;
