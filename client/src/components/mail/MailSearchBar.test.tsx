import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MailSearchBar } from './MailSearchBar';

/**
 * "Clear all" clears the search, not the folder.
 *
 * The folder is not a filter — it is where the user is. Wiping it here sent you
 * back to the Inbox from Archive, Sent or Snoozed the moment you cleared a
 * search, which is exactly when you are looking at results rather than at the
 * folder list. The component's own filter count already excludes the folder,
 * so the two disagreed about what a filter was.
 */

vi.mock('../../api/customers', () => ({
  contactsApi: { search: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));

vi.mock('../shared/CompanyComboBox', () => ({
  CompanyComboBox: () => <div data-testid="company-combobox-stub" />,
}));

const BASE = {
  search: '',
  from: '',
  to: '',
  subject: '',
  dateAfter: '',
  dateBefore: '',
  customerIds: [],
  isRead: null,
  hasAttachment: false,
  folder: null,
};

beforeEach(() => vi.clearAllMocks());

describe('MailSearchBar — Clear all', () => {
  it('keeps the folder you are reading', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(
      <MailSearchBar
        // `subject` is what puts the Clear all button on screen: the tag row
        // it lives in is driven by the advanced filters, and search and folder
        // are excluded from it by design.
        filters={{ ...BASE, folder: 'archive', search: 'invoice', subject: 'Q3' }}
        onFiltersChange={onFiltersChange}
      />
    );

    await user.click(await screen.findByRole('button', { name: /clear all/i }));

    await waitFor(() => expect(onFiltersChange).toHaveBeenCalled());
    const next = onFiltersChange.mock.calls[0][0];
    expect(next.folder).toBe('archive');
  });

  it('still clears everything that IS a filter', async () => {
    // The guard against over-correcting: preserving the folder must not turn
    // "Clear all" into "clear nothing".
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(
      <MailSearchBar
        filters={{
          ...BASE,
          folder: 'sent',
          search: 'invoice',
          subject: 'Q3',
          hasAttachment: true,
          isRead: 'false',
        }}
        onFiltersChange={onFiltersChange}
      />
    );

    await user.click(await screen.findByRole('button', { name: /clear all/i }));

    await waitFor(() => expect(onFiltersChange).toHaveBeenCalled());
    const next = onFiltersChange.mock.calls[0][0];
    expect(next).toMatchObject({
      folder: 'sent',
      search: '',
      subject: '',
      hasAttachment: false,
      isRead: null,
    });
  });

  it('leaves a null folder null rather than inventing one', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(
      <MailSearchBar
        filters={{ ...BASE, search: 'invoice', subject: 'Q3' }}
        onFiltersChange={onFiltersChange}
      />
    );

    await user.click(await screen.findByRole('button', { name: /clear all/i }));

    await waitFor(() => expect(onFiltersChange).toHaveBeenCalled());
    expect(onFiltersChange.mock.calls[0][0].folder).toBeNull();
  });
});
