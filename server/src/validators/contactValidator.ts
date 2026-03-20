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

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
