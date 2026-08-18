/**
 * Which direction mail has ever flowed with a contact.
 *
 * Named from the contact's side: `sender` means they have written to this
 * account, `receiver` means this account has written to them.
 *
 * This is the axis that actually separates a contact list worth reading from one
 * that is not. Measured on this database: only 2,013 of 11,694 contacts are
 * `both`, while 5,068 — 43% — are `none`, addresses that only ever appeared in
 * somebody else's cc list or on a meeting invitation. Whether an address belongs
 * to a person (see contactKind.ts) is a different and much weaker signal.
 */

export type ContactEngagement = 'none' | 'sender' | 'receiver' | 'both';

export const CONTACT_ENGAGEMENTS: readonly ContactEngagement[] = [
  'none',
  'sender',
  'receiver',
  'both',
];

/**
 * Fold a newly observed direction into what is already known.
 *
 * Monotonic on purpose — engagement only ever widens. A contact who has written
 * to you once has done so permanently, and re-deriving from a mailbox that only
 * syncs a window of history would otherwise quietly downgrade them.
 */
export function mergeEngagement(
  current: string | null | undefined,
  observed: 'sender' | 'receiver'
): ContactEngagement {
  const base: ContactEngagement =
    current === 'sender' || current === 'receiver' || current === 'both' ? current : 'none';

  if (base === 'both' || base === observed) return base;
  if (base === 'none') return observed;
  // One of each.
  return 'both';
}

/** Build the value from the two facts directly, for the backfill. */
export function engagementFrom(hasSent: boolean, hasReceived: boolean): ContactEngagement {
  if (hasSent && hasReceived) return 'both';
  if (hasSent) return 'sender';
  if (hasReceived) return 'receiver';
  return 'none';
}
