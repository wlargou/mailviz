import { z } from 'zod';
import { OPTIONAL_MAIL_CATEGORIES } from '../utils/mailCategories.js';

/**
 * Deleting an account is irreversible and cascades across every table the
 * account owns, so the request has to carry a deliberate signal rather than
 * just a valid session. Re-typing the address is that signal — it cannot be
 * produced by a stray click, a replayed request, or a UI bug.
 *
 * The value is compared against the caller's own address in `accountService`;
 * this only guarantees something plausible arrived.
 */
export const deleteAccountSchema = z.object({
  confirmEmail: z.string().trim().min(1, 'Confirmation email is required').max(255),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

/**
 * The caller's IANA timezone, e.g. "Europe/Paris".
 *
 * Validated against the runtime's own tz database rather than a checked-in
 * list: IANA adds and renames zones several times a year, and a hard-coded set
 * would start rejecting legitimate values the first time that happened.
 *
 * The length cap is belt-and-braces against a client sending something absurd
 * for a VARCHAR(64) column — `Intl` would reject it anyway, but the column
 * should not depend on that.
 */
export const updateTimezoneSchema = z.object({
  timezone: z
    .string()
    .trim()
    .min(1, 'Timezone is required')
    .max(64)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en-CA', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Not a recognised IANA timezone'),
});

/**
 * Which Gmail category tabs to show beside Primary. Primary is not in the
 * list because it cannot be hidden. Order is the app's, not the caller's:
 * the tabs always render in the fixed order, so a duplicate or a reordering
 * in the body is normalised away rather than stored.
 */
export const updateMailCategoryTabsSchema = z.object({
  tabs: z
    .array(z.enum(OPTIONAL_MAIL_CATEGORIES))
    .max(OPTIONAL_MAIL_CATEGORIES.length)
    .transform((tabs) => OPTIONAL_MAIL_CATEGORIES.filter((c) => tabs.includes(c))),
});
