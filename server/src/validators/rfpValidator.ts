import { z } from 'zod';
import { RFP_DOCUMENT_KINDS, RFP_STATUSES, RFP_SUBMISSION_FORMATS } from '../utils/rfp.js';
import { RFP_FOLDER_KINDS, RFP_ITEM_STATUSES } from '../utils/rfpComposition.js';

export const rfpStatusSchema = z.enum(RFP_STATUSES);
export const rfpSubmissionFormatSchema = z.enum(RFP_SUBMISSION_FORMATS);
export const rfpDocumentKindSchema = z.enum(RFP_DOCUMENT_KINDS);

/**
 * `.trim()` before the length check, not after: a trailing transform runs
 * after `min(1)`, so '   ' would satisfy it and then be stored empty.
 */
const trimmed = (max: number) => z.string().trim().min(1).max(max);

/// In MAD. Bounded below at zero and above at what `Decimal(14,2)` holds.
const budgetSchema = z.number().min(0).max(999999999999.99).nullable();

export const rfpFolderKindSchema = z.enum(RFP_FOLDER_KINDS);
export const rfpItemStatusSchema = z.enum(RFP_ITEM_STATUSES);

export const lotInputSchema = z.object({
  title: trimmed(500),
  budget: budgetSchema.optional(),
});
export const createLotSchema = lotInputSchema;
export const updateLotSchema = lotInputSchema.partial();

export const createFolderSchema = z.object({
  kind: rfpFolderKindSchema,
  /// Required for the per-lot kinds, refused for the rest — checked in the
  /// service, which knows which is which and which lots the tender has.
  lotId: z.string().uuid().nullable().optional(),
  title: trimmed(255).optional(),
  prefill: z.boolean().optional(),
});
export const updateFolderSchema = z.object({ title: trimmed(255) });

export const createItemSchema = z.object({ title: trimmed(500) });
export const updateItemSchema = z.object({
  title: trimmed(500).optional(),
  status: rfpItemStatusSchema.optional(),
  notes: z.string().max(10000).nullable().optional().or(z.literal('')),
});

export const createRfpSchema = z.object({
  name: trimmed(500),
  reference: trimmed(255),
  /// Required: a tender with no deadline is not something anyone can act on.
  deadlineAt: z.string().datetime({ offset: true }),
  submissionFormat: rfpSubmissionFormatSchema,
  /// Only meaningful with PORTAL, and `.url()` alone would accept
  /// `javascript:` — which reaches an href and a window.open on the client.
  portalUrl: z
    .string()
    .trim()
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL')
    .optional()
    .nullable()
    .or(z.literal('')),
  /// The buying company. A plain foreign key into a user-scoped table, so
  /// the service checks it belongs to the caller — see rfpService.
  customerId: z.string().uuid().nullable().optional(),
  isGoe: z.boolean().optional(),
  status: rfpStatusSchema.optional(),
  notes: z.string().max(10000).optional().nullable().or(z.literal('')),
  /// The lots, in order. Absent means one "Lot unique" with no budget — the
  /// common case. The tender's budget is their total, never sent directly.
  lots: z.array(lotInputSchema).min(1).max(50).optional(),
  /// Which dossiers to prepare, and whether to fill them with the standard
  /// pieces. Per-lot kinds (the offers) are created once per lot.
  composition: z
    .object({
      kinds: z.array(rfpFolderKindSchema).max(RFP_FOLDER_KINDS.length),
      prefill: z.boolean(),
    })
    .optional(),
});

/**
 * `.partial()` keeps a `.default()` inside its optional wrapper, so an absent
 * field on a PATCH would still parse as the default and overwrite the row —
 * the `updateDealSchema` bug. `createRfpSchema` declares no defaults for that
 * reason; the column defaults live in the database.
 *
 * Lots and composition are not edited through the tender: they have their
 * own endpoints, so a PATCH cannot replace them wholesale by accident.
 */
export const updateRfpSchema = createRfpSchema.omit({ lots: true, composition: true }).partial();

/** Recipients of a share. Ids only — the server resolves the people. */
export const shareRfpSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(50),
});

export const createRfpDocumentSchema = z.object({
  kind: rfpDocumentKindSchema.optional(),
});

export type CreateRfpInput = z.infer<typeof createRfpSchema>;
export type UpdateRfpInput = z.infer<typeof updateRfpSchema>;
