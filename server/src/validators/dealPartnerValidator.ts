import { z } from 'zod';

export const createDealPartnerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255).transform(s => s.trim()),
  registrationUrl: z.string().url().max(500).optional().or(z.literal('')),
  logoUrl: z.string().url().max(500).optional().or(z.literal('')),
});

export const updateDealPartnerSchema = createDealPartnerSchema.partial();

export type CreateDealPartnerInput = z.infer<typeof createDealPartnerSchema>;
export type UpdateDealPartnerInput = z.infer<typeof updateDealPartnerSchema>;
