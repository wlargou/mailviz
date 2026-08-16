import { z } from 'zod';

/**
 * A template is a whole message (subject + body); a snippet is a fragment that
 * gets dropped at the cursor and therefore has no subject of its own.
 */
export const templateKindSchema = z.enum(['template', 'snippet']);

const baseTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: templateKindSchema.default('template'),
  // Nullable rather than just optional: clearing a template's subject has to be
  // expressible, and turning a template into a snippet sends `subject: null`.
  subject: z.string().max(500).nullable().optional(),
  body: z.string().min(1).max(100_000),
});

export const createTemplateSchema = baseTemplateSchema;

// `.partial()` on the base would drop the `kind` default, which is what we want
// for a PATCH — an absent field means "leave it alone", not "reset to default".
export const updateTemplateSchema = baseTemplateSchema.partial();

/**
 * The context compose can supply for variable substitution.
 *
 * Deliberately tiny: it is exactly what the compose window actually knows about
 * the person being written to. `recipientName` is a display-name hint (Gmail's
 * `From: Jane Doe <jane@…>`), used only when no Contact row matches the address.
 */
export const renderTemplateSchema = z.object({
  recipientEmail: z.string().trim().max(320).optional(),
  recipientName: z.string().trim().max(255).optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type RenderTemplateInput = z.infer<typeof renderTemplateSchema>;
