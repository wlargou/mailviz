import { z } from 'zod';

export const dealStatusSchema = z.enum(['TO_CHALLENGE', 'APPROVED', 'DECLINED']);

export const createDealSchema = z.object({
  // `.trim()` before the length checks, not a trailing `.transform`: trimming
  // last means '   ' satisfies min(1) and is then stored as an empty title.
  title: z.string().trim().min(1).max(255),
  partnerId: z.string().uuid(),
  customerId: z.string().uuid().optional().nullable(),
  products: z.string().optional().or(z.literal('')),
  status: dealStatusSchema.optional().default('TO_CHALLENGE'),
  expiryDate: z.string().optional().nullable(),
  notes: z.string().optional().or(z.literal('')),
});

// `.partial()` on its own is not enough. Zod keeps the `.default()` inside the
// optional wrapper, so an absent `status` still parses as 'TO_CHALLENGE' — and
// `dealService.update` writes the parsed body straight to the row, which turned
// any edit (renaming, adding a note) into a silent reset of an APPROVED deal
// back to TO_CHALLENGE. Re-declaring the field without its default restores
// what a PATCH is supposed to mean: absent is "leave it alone".
export const updateDealSchema = createDealSchema.partial().extend({
  status: dealStatusSchema.optional(),
});

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
