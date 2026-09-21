/**
 * Gmail's inbox categories, as the inbox tabs show them. Mirrors
 * server/src/utils/mailCategories.ts; the ids travel in the API.
 */
export const OPTIONAL_MAIL_CATEGORIES = ['social', 'promotions', 'updates', 'forums'] as const;
export type OptionalMailCategory = (typeof OPTIONAL_MAIL_CATEGORIES)[number];
export type MailCategory = 'primary' | OptionalMailCategory;

export const MAIL_CATEGORY_LABELS: Record<MailCategory, string> = {
  primary: 'Primary',
  social: 'Social',
  promotions: 'Promotions',
  updates: 'Updates',
  forums: 'Forums',
};

export type CategoryCounts = Record<MailCategory, number>;

export function isMailCategory(value: unknown): value is MailCategory {
  return value === 'primary' || (OPTIONAL_MAIL_CATEGORIES as readonly string[]).includes(value as string);
}

/** Tabs a user has not hidden, in the fixed order. `undefined` (older session shape) means all. */
export function visibleCategories(tabs: readonly string[] | undefined): MailCategory[] {
  const shown = tabs ? OPTIONAL_MAIL_CATEGORIES.filter((c) => tabs.includes(c)) : [...OPTIONAL_MAIL_CATEGORIES];
  return ['primary', ...shown];
}
