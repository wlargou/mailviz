import { z } from 'zod';

/**
 * A URL that is safe to put behind a link the user is invited to click.
 *
 * `z.string().url()` is not that check. Zod accepts any well-formed URI, scheme
 * included — `javascript:alert(1)` and `data:text/html,<script>…</script>` both
 * parse clean. `registrationUrl` is rendered as a button that calls
 * `window.open(...)` (client/src/components/deals/DealsPage.tsx), and deals are
 * shareable, so an attacker-authored partner reaches a *second* user's browser
 * and runs there. Restricting the scheme is the control the link actually needs.
 */
const httpUrl = z
  .string()
  .url()
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u), { message: 'URL must start with http:// or https://' });

export const createDealPartnerSchema = z.object({
  // `.trim()` before the length checks, not a trailing `.transform`: trimming
  // last means '   ' satisfies min(1) and is then stored as an empty name.
  name: z.string().trim().min(1, 'Name is required').max(255),
  registrationUrl: httpUrl.optional().or(z.literal('')),
  logoUrl: httpUrl.optional().or(z.literal('')),
});

export const updateDealPartnerSchema = createDealPartnerSchema.partial();

export type CreateDealPartnerInput = z.infer<typeof createDealPartnerSchema>;
export type UpdateDealPartnerInput = z.infer<typeof updateDealPartnerSchema>;
