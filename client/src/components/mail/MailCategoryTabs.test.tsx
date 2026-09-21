import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MailCategoryTabs } from './MailCategoryTabs';

/**
 * The inbox tabs render exactly the categories they are given — the user's
 * choice, Primary first — with an unread badge only where there is
 * something unread, and hand back the category id on a click.
 */
describe('MailCategoryTabs', () => {
  const counts = { primary: 3, social: 0, promotions: 1200, updates: 7, forums: 0 };

  it('shows the given tabs, with a badge only for unread, capped at 999+', () => {
    render(<MailCategoryTabs categories={['primary', 'promotions', 'updates']} selected="updates" counts={counts} onSelect={vi.fn()} onCustomize={vi.fn()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Primary3', 'Promotions999+', 'Updates7']);
    expect(screen.queryByRole('tab', { name: /Social/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /Updates/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Primary/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('renders no badge at all while the counts are still loading', () => {
    render(<MailCategoryTabs categories={['primary', 'social']} selected="primary" counts={null} onSelect={vi.fn()} onCustomize={vi.fn()} />);

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Primary', 'Social']);
  });

  it('reports the clicked category and the customize request', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onCustomize = vi.fn();
    render(<MailCategoryTabs categories={['primary', 'social', 'forums']} selected="primary" counts={counts} onSelect={onSelect} onCustomize={onCustomize} />);

    await user.click(screen.getByRole('tab', { name: /Forums/ }));
    expect(onSelect).toHaveBeenCalledWith('forums');

    await user.click(screen.getByRole('button', { name: 'Customize categories' }));
    expect(onCustomize).toHaveBeenCalled();
  });
});
