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
  if (totalSize > MAX_TOTAL_SIZE) return false;
  for (const att of attachments) {
    if (BLOCKED_EXTENSIONS.test(att.filename)) return false;
    if (att.size > MAX_TOTAL_SIZE) return false;
  }
  return true;
}

/**
 * A draft is half-written by definition, so unlike `sendEmailSchema` nothing
 * here is required: no recipients, no subject, no body. The one thing still
 * enforced is the attachment policy, because a draft's attachments are the same
 * bytes that eventually leave the building.
 */
export const saveDraftSchema = z.object({
  to: z.array(emailString).optional().default([]),
  cc: z.array(emailString).optional().default([]),
  bcc: z.array(emailString).optional().default([]),
  subject: z.string().max(500).optional().default(''),
  htmlBody: z.string().max(500000).optional().default(''),
  attachments: attachmentsField,
  replyToEmailId: z.string().uuid().optional(),
}).refine(
  (data) => validateAttachments(data.attachments),
  { message: 'Attachments exceed 25MB limit or contain blocked file types', path: ['attachments'] }
);

/** Sending is the point where a draft has to become a real message. */
export const sendDraftSchema = z.object({
  to: z.array(emailString).min(1, 'At least one recipient is required'),
  cc: z.array(emailString).optional().default([]),
  bcc: z.array(emailString).optional().default([]),
  subject: z.string().max(500).optional().default(''),
  htmlBody: z.string().max(500000).optional().default(''),
  attachments: attachmentsField,
  replyToEmailId: z.string().uuid().optional(),
}).refine(
  (data) => validateAttachments(data.attachments),
  { message: 'Attachments exceed 25MB limit or contain blocked file types', path: ['attachments'] }
);

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;
export type SendDraftInput = z.infer<typeof sendDraftSchema>;
