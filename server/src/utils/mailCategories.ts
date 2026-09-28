import type { Prisma } from '../lib/prismaClient.js';

/**
 * Gmail's inbox categories.
 *
 * Gmail sorts inbox mail into Primary, Social, Promotions, Updates and
 * Forums with its own classifiers, and reports the verdict on every message
 * as a system label. The app does not classify anything: it filters on those
 * labels, which the sync already stores in `emails.label_ids`.
 *
 * Primary is "everything Gmail did not put elsewhere", not `CATEGORY_PERSONAL`:
 * a message with no category label at all (older mail, mail from before
 * categories were on) belongs in the default view, not nowhere — unless it is
 * from a machine (`isAutomated`), which the app files under Updates. That is
 * the one place the app does classify, and it only moves uncategorised mail.
 */
export const OPTIONAL_MAIL_CATEGORIES = ['social', 'promotions', 'updates', 'forums'] as const;
export type OptionalMailCategory = (typeof OPTIONAL_MAIL_CATEGORIES)[number];
export type MailCategory = 'primary' | OptionalMailCategory;
export const MAIL_CATEGORIES: readonly MailCategory[] = ['primary', ...OPTIONAL_MAIL_CATEGORIES];

export const CATEGORY_LABELS: Record<OptionalMailCategory, string> = {
  social: 'CATEGORY_SOCIAL',
  promotions: 'CATEGORY_PROMOTIONS',
  updates: 'CATEGORY_UPDATES',
  forums: 'CATEGORY_FORUMS',
};

export function isMailCategory(value: unknown): value is MailCategory {
  return typeof value === 'string' && (MAIL_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The where-clause for one category — the same object for the list and the
 * counts, so a tab can never show a number its list does not.
 */
export function categoryFilter(category: MailCategory): Prisma.EmailWhereInput {
  const uncategorised: Prisma.EmailWhereInput = {
    NOT: { labelIds: { hasSome: Object.values(CATEGORY_LABELS) } },
  };
  if (category === 'primary') {
    // Gmail leaves plenty of machine mail uncategorised — alerts, receipts,
    // "your export is ready" — and Primary is where people write.
    return { AND: [uncategorised, { isAutomated: false }] };
  }
  if (category === 'updates') {
    // What Primary turns away lands here, so it is not lost from the inbox.
    return {
      OR: [
        { labelIds: { has: CATEGORY_LABELS.updates } },
        { AND: [uncategorised, { isAutomated: true }] },
      ],
    };
  }
  return { labelIds: { has: CATEGORY_LABELS[category] } };
}
