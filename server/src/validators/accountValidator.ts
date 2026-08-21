import { z } from 'zod';

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
