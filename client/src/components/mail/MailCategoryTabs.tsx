import { Tabs, TabList, Tab, Button } from '@carbon/react';
import { SettingsAdjust } from '@carbon/icons-react';
import { MAIL_CATEGORY_LABELS, type CategoryCounts, type MailCategory } from '../../utils/mailCategories';

interface MailCategoryTabsProps {
  /** Categories to show, Primary first — the user's choice, see MailCategoriesModal. */
  categories: MailCategory[];
  selected: MailCategory;
  /** Unread threads per category; null while loading, and the badge is simply absent. */
  counts: CategoryCounts | null;
  onSelect: (category: MailCategory) => void;
  onCustomize: () => void;
}

/**
 * Gmail's inbox tabs: Primary, Social, Promotions, Updates, Forums, each with
 * its unread count. Gmail is the classifier; the tabs only filter on the
 * labels it assigned. Primary is the inbox's default view and cannot be
 * hidden; the others are the user's to show or hide.
 */
export function MailCategoryTabs({ categories, selected, counts, onSelect, onCustomize }: MailCategoryTabsProps) {
  const selectedIndex = Math.max(0, categories.indexOf(selected));
  return (
    <div className="mail-category-tabs">
      <Tabs selectedIndex={selectedIndex} onChange={({ selectedIndex: i }) => onSelect(categories[i] ?? 'primary')}>
        <TabList aria-label="Inbox categories" contained>
          {categories.map((category) => {
            const count = counts?.[category] ?? 0;
            return (
              <Tab key={category}>
                {MAIL_CATEGORY_LABELS[category]}
                {count > 0 && (
                  <span className="mail-category-tabs__count" aria-label={`${count} unread`}>{count > 999 ? '999+' : count}</span>
                )}
              </Tab>
            );
          })}
        </TabList>
      </Tabs>
      <Button
        kind="ghost"
        size="sm"
        hasIconOnly
        iconDescription="Customize categories"
        renderIcon={SettingsAdjust}
        onClick={onCustomize}
        className="mail-category-tabs__customize"
      />
    </div>
  );
}
