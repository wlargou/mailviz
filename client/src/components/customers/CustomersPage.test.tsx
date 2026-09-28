import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CustomersPage } from './CustomersPage';
import { customersApi } from '../../api/customers';
import type { Customer } from '../../types/customer';

/**
 * Companies, split into accounts and senders.
 *
 * 11,000 "companies" were mostly domains that had mailed once. The page now
 * opens on accounts, busiest first, and the rest wait in "Senders to review"
 * to be kept or ignored — one at a time or a page at a time. Pinned: which
 * status each tab asks the server for, and which status each triage action
 * writes, because the wrong one silently files a company in the wrong place.
 */

vi.mock('../../api/customers', () => ({
  customersApi: {
    getAll: vi.fn(),
    getStatusCounts: vi.fn(),
    setStatus: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('../../api/companyCategories', () => ({
  companyCategoriesApi: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));
vi.mock('./CustomerCreateModal', () => ({ CustomerCreateModal: () => null }));

function company(id: string, name: string, emails = 0): Customer {
  return {
    id, name, email: null, phone: null, company: null, website: null, domain: `${id}.test`,
    logoUrl: null, notes: null, categoryId: null, isVip: false, category: null,
    createdAt: '', updatedAt: '', _count: { contacts: 0, tasks: 0, emails },
  };
}

const getAll = vi.mocked(customersApi.getAll);
const setStatus = vi.mocked(customersApi.setStatus);

beforeEach(() => {
  vi.clearAllMocks();
  getAll.mockImplementation(async (params) => {
    const rows = params?.status === 'SENDER'
      ? [company('s1', 'Newsletter Co', 40), company('s2', 'Bank Alerts', 12)]
      : params?.status === 'IGNORED'
        ? [company('i1', 'Spammy')]
        : [company('a1', 'Lydec', 3046)];
    return { data: { data: rows, meta: { total: rows.length, page: 1, limit: 20, totalPages: 1 } } } as never;
  });
  vi.mocked(customersApi.getStatusCounts).mockResolvedValue({ data: { data: { ACCOUNT: 212, SENDER: 10840, IGNORED: 3 } } } as never);
  setStatus.mockResolvedValue({ data: { data: { updated: 1 } } } as never);
});

function renderPage() {
  render(
    <MemoryRouter>
      <CustomersPage />
    </MemoryRouter>,
  );
}

const lastParams = () => getAll.mock.calls.at(-1)?.[0];

describe('CustomersPage — accounts and senders', () => {
  it('opens on accounts, busiest first, with each tab counted', async () => {
    renderPage();
    expect(await screen.findByText('Lydec')).toBeInTheDocument();
    expect(lastParams()).toMatchObject({ status: 'ACCOUNT', sortBy: 'emailCount', sortOrder: 'desc' });
    expect(await screen.findByRole('tab', { name: /Senders to review\s*10 840/ })).toBeInTheDocument();
    // Nothing to triage on the accounts tab.
    expect(screen.queryByRole('checkbox', { name: /Select Lydec/ })).not.toBeInTheDocument();
    expect(screen.getByText('3 046')).toBeInTheDocument();
  });

  it('keeps and ignores a sender from its row', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Senders to review/ }));
    const row = (await screen.findByText('Newsletter Co')).closest('tr')!;
    expect(lastParams()).toMatchObject({ status: 'SENDER' });

    await user.click(within(row).getByRole('button', { name: 'Keep' }));
    expect(setStatus).toHaveBeenLastCalledWith(['s1'], 'ACCOUNT');

    const bank = (await screen.findByText('Bank Alerts')).closest('tr')!;
    await user.click(within(bank).getByRole('button', { name: 'Ignore' }));
    expect(setStatus).toHaveBeenLastCalledWith(['s2'], 'IGNORED');
  });

  it('keeps or ignores a selection in one go, and refreshes', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Senders to review/ }));
    await user.click(await screen.findByRole('checkbox', { name: 'Select every company on this page' }));

    const bar = screen.getByRole('region', { name: 'Selected companies' });
    expect(bar).toHaveTextContent('2 selected');
    const fetchesBefore = getAll.mock.calls.length;
    await user.click(within(bar).getByRole('button', { name: 'Ignore' }));

    expect(setStatus).toHaveBeenCalledWith(['s1', 's2'], 'IGNORED');
    await waitFor(() => expect(getAll.mock.calls.length).toBeGreaterThan(fetchesBefore));
    expect(screen.queryByRole('region', { name: 'Selected companies' })).not.toBeInTheDocument();
  });

  it('puts an ignored sender back up for review, not straight into accounts', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Ignored/ }));
    const row = (await screen.findByText('Spammy')).closest('tr')!;
    expect(lastParams()).toMatchObject({ status: 'IGNORED' });

    await user.click(within(row).getByRole('button', { name: 'Un-ignore' }));
    expect(setStatus).toHaveBeenLastCalledWith(['i1'], 'SENDER');
  });

  it('can demote an account from its row menu', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Lydec');
    await user.click(screen.getByRole('button', { name: 'Actions for Lydec' }));
    const items = await screen.findAllByRole('menuitem', { hidden: true });
    await user.click(items.find((i) => i.textContent?.includes('Not an account'))!);
    expect(setStatus).toHaveBeenLastCalledWith(['a1'], 'SENDER');
  });
});
