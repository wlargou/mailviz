import { z } from 'zod';

const emailString = z.string().email().max(255);

export const sendEmailSchema = z.object({
  to: z.array(emailString).min(1, 'At least one recipient is required'),
  cc: z.array(emailString).optional().default([]),
  bcc: z.array(emailString).optional().default([]),
  subject: z.string().min(1).max(500),
  htmlBody: z.string().min(1).max(500000),
});

export const replyEmailSchema = z.object({
  htmlBody: z.string().min(1).max(500000),
  replyAll: z.boolean().optional().default(false),
  cc: z.array(emailString).optional().default([]),
  bcc: z.array(emailString).optional().default([]),
});

export const forwardEmailSchema = z.object({
  to: z.array(emailString).min(1, 'At least one recipient is required'),
  cc: z.array(emailString).optional().default([]),
  bcc: z.array(emailString).optional().default([]),
  htmlBody: z.string().min(1).max(500000),
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;
export type ReplyEmailInput = z.infer<typeof replyEmailSchema>;
export type ForwardEmailInput = z.infer<typeof forwardEmailSchema>;
