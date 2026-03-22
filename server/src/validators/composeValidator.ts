import { z } from 'zod';

const emailString = z.string().email().max(255);

const BLOCKED_EXTENSIONS = /\.(exe|bat|cmd|com|msi|scr|pif|vbs|js|wsf|cpl)$/i;
const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25MB

const attachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  content: z.string().min(1),
  contentType: z.string().min(1).max(255),
  size: z.number().int().positive(),
});

const attachmentsField = z.array(attachmentSchema).max(20).optional().default([]);

function validateAttachments(attachments: z.infer<typeof attachmentSchema>[]) {
  const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    return false;
  }
  for (const att of attachments) {
    if (BLOCKED_EXTENSIONS.test(att.filename)) return false;
    if (att.size > MAX_TOTAL_SIZE) return false;
  }
  return true;
}

export const sendEmailSchema = z.object({
  to: z.array(emailString).min(1, 'At least one recipient is required'),
  cc: z.array(emailString).optional().default([]),
  bcc: z.array(emailString).optional().default([]),
  subject: z.string().min(1).max(500),
  htmlBody: z.string().min(1).max(500000),
  attachments: attachmentsField,
}).refine(
  (data) => validateAttachments(data.attachments),
  { message: 'Attachments exceed 25MB limit or contain blocked file types', path: ['attachments'] }
);

export const replyEmailSchema = z.object({
  htmlBody: z.string().min(1).max(500000),
  replyAll: z.boolean().optional().default(false),
  cc: z.array(emailString).optional().default([]),
  bcc: z.array(emailString).optional().default([]),
  attachments: attachmentsField,
}).refine(
  (data) => validateAttachments(data.attachments),
  { message: 'Attachments exceed 25MB limit or contain blocked file types', path: ['attachments'] }
);

export const forwardEmailSchema = z.object({
  to: z.array(emailString).min(1, 'At least one recipient is required'),
  cc: z.array(emailString).optional().default([]),
  bcc: z.array(emailString).optional().default([]),
  htmlBody: z.string().max(500000).optional().default(''),
  attachments: attachmentsField,
  forwardExistingAttachments: z.array(z.string().uuid()).optional().default([]),
}).refine(
  (data) => validateAttachments(data.attachments),
  { message: 'Attachments exceed 25MB limit or contain blocked file types', path: ['attachments'] }
);

export const scheduleEmailSchema = z.object({
  sendAt: z.string().datetime(),
  mode: z.enum(['new', 'reply', 'replyAll', 'forward']),
  replyToEmailId: z.string().uuid().optional(),
  to: z.array(emailString).optional().default([]),
  cc: z.array(emailString).optional().default([]),
  bcc: z.array(emailString).optional().default([]),
  subject: z.string().max(500).optional().default(''),
  htmlBody: z.string().min(1).max(500000),
  attachments: attachmentsField,
  forwardExistingAttachments: z.array(z.string().uuid()).optional().default([]),
}).refine(
  (data) => new Date(data.sendAt) > new Date(),
  { message: 'Send time must be in the future', path: ['sendAt'] }
).refine(
  (data) => {
    if (data.mode === 'new' || data.mode === 'forward') return data.to.length > 0;
    return true;
  },
  { message: 'At least one recipient required', path: ['to'] }
);

export const updateScheduledEmailSchema = z.object({
  sendAt: z.string().datetime(),
}).refine(
  (data) => new Date(data.sendAt) > new Date(),
  { message: 'Send time must be in the future', path: ['sendAt'] }
);

export type SendEmailInput = z.infer<typeof sendEmailSchema>;
export type ReplyEmailInput = z.infer<typeof replyEmailSchema>;
export type ForwardEmailInput = z.infer<typeof forwardEmailSchema>;
export type ScheduleEmailInput = z.infer<typeof scheduleEmailSchema>;
export type UpdateScheduledEmailInput = z.infer<typeof updateScheduledEmailSchema>;
