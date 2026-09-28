import { z } from 'zod';

export const createCustomerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional().or(z.literal('')),
  company: z.string().max(255).optional().or(z.literal('')),
  website: z.string().max(255).optional().or(z.literal('')),
  // Drives email -> customer auto-linking (see utils/domainResolver.ts). Without
  // this here, Zod strips it and manually created companies never link to mail.
  domain: z.string().max(255).optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  categoryId: z.string().uuid().optional().nullable(),
  isVip: z.boolean().optional(),
});

export const companyStatusSchema = z.enum(['ACCOUNT', 'SENDER', 'IGNORED']);

export const updateCustomerSchema = createCustomerSchema.partial().extend({ status: companyStatusSchema.optional() });

export const setCompanyStatusSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  status: companyStatusSchema,
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
