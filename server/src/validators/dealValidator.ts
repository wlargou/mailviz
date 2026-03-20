import { z } from 'zod';

export const createDealSchema = z.object({
  title: z.string().min(1).max(255).transform(s => s.trim()),
  partnerId: z.string().uuid(),
  customerId: z.string().uuid().optional().nullable(),
  products: z.string().optional().or(z.literal('')),
  status: z.enum(['TO_CHALLENGE', 'APPROVED', 'DECLINED']).optional().default('TO_CHALLENGE'),
  expiryDate: z.string().optional().nullable(),
  notes: z.string().optional().or(z.literal('')),
});

export const updateDealSchema = createDealSchema.partial();

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
