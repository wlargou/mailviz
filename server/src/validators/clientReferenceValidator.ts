import { z } from 'zod';
import {
  PARTIAL_DATE_RE,
  REFERENCE_AMOUNT_TYPES,
  REFERENCE_APPRECIATIONS,
  REFERENCE_DOCUMENT_TYPES,
  REFERENCE_WORK_STATUSES,
  parsePartialDate,
} from '../utils/clientReference.js';

/** `.trim()` before `.min()` — see the gotcha in CLAUDE.md. */
const trimmed = (max: number) => z.string().trim().min(1).max(max);

/**
 * An optional text: '' and null both clear it. Trimmed, so a field of spaces
 * is stored as nothing rather than as spaces.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((s) => (s ? s : null));

/** "2025", "2025-07" or "2025-07-30" — as precise as the letter is. */
const partialDate = z
  .string()
  .trim()
  .refine((s) => s === '' || (PARTIAL_DATE_RE.test(s) && parsePartialDate(s) !== null), 'Use YYYY, YYYY-MM or YYYY-MM-DD')
  .nullable()
  .transform((s) => (s ? s : null));

/** A day: the signature is always dated to the day when it is dated at all. */
const day = z
  .string()
  .trim()
  .refine((s) => s === '' || (/^\d{4}-\d{2}-\d{2}$/.test(s) && parsePartialDate(s) !== null), 'Use YYYY-MM-DD')
  .nullable()
  .transform((s) => (s ? s : null));

/** One entry per line of the letter's list; blanks dropped, each trimmed. */
const lines = (max: number, each: number) =>
  z
    .array(z.string().trim().max(each))
    .max(max)
    .transform((a) => a.filter(Boolean));

export const signatorySchema = z
  .object({
    name: optionalText(255).optional(),
    role: optionalText(500).optional(),
  })
  .refine((s) => s.name || s.role, 'A signatory needs a name or a role');

/**
 * No `.default()` anywhere: the update schema is this one made partial, and
 * `.partial()` keeps a default inside its optional wrapper, so an absent field
 * on a PATCH would parse as the default and overwrite the row (the
 * `updateDealSchema` bug). The column defaults live in the database.
 */
export const createClientReferenceSchema = z.object({
  documentType: z.enum(REFERENCE_DOCUMENT_TYPES).optional(),
  workStatus: z.enum(REFERENCE_WORK_STATUSES).optional(),
  customerName: trimmed(500),
  /// A plain foreign key into a user-scoped table: the service checks that
  /// the company is the caller's.
  customerId: z.string().uuid().nullable().optional(),
  city: optionalText(100).optional(),
  projectName: optionalText(5000).optional(),
  projectReference: optionalText(500).optional(),
  attestationNumber: optionalText(255).optional(),
  /// Bounded by what `Decimal(16,2)` holds.
  amount: z.number().min(0).max(99999999999999.99).nullable().optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'A three-letter currency code')
    .optional(),
  amountType: z.enum(REFERENCE_AMOUNT_TYPES).nullable().optional(),
  amountScope: optionalText(255).optional(),
  appreciation: z.enum(REFERENCE_APPRECIATIONS).optional(),
  appreciationQuote: optionalText(5000).optional(),
  projectStart: partialDate.optional(),
  projectEnd: partialDate.optional(),
  signedAt: day.optional(),
  signedPlace: optionalText(100).optional(),
  technologies: lines(300, 500).optional(),
  prestations: lines(200, 500).optional(),
  partners: lines(30, 100).optional(),
  consortiumPartners: lines(20, 255).optional(),
  details: optionalText(20000).optional(),
  signatories: z.array(signatorySchema).max(20).optional(),
  needsReview: z.boolean().optional(),
  reviewNotes: optionalText(20000).optional(),
});

export const updateClientReferenceSchema = createClientReferenceSchema.partial();

export type CreateClientReferenceInput = z.infer<typeof createClientReferenceSchema>;
export type UpdateClientReferenceInput = z.infer<typeof updateClientReferenceSchema>;
