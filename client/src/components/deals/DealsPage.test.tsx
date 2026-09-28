import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { DealsPage } from './DealsPage';
import { dealsApi } from '../../api/deals';

/**
 * Deal rows follow the table template: the row opens the deal, its actions
 * sit in one overflow menu, and a link inside the row goes where it says
 * rather than also opening the row.
 */

vi.mock('../../api/deals', () => ({ dealsApi: { getAll: vi.fn(), delete: vi.fn(), getDealShares: vi.fn() } }));
vi.mock('../../api/dealPartners', () => ({ dealPartnersApi: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) } }));
vi.mock('./DealCreateModal', () => ({
  DealCreateModal: ({ open, editDeal }: { open: boolean; editDeal: { title: string } | null }) =>
    open ? <div>editing {editDeal?.title ?? 'new'}</div> : null,
}));
vi.mock('../shared/ConfirmDeleteModal', () => ({
  ConfirmDeleteModal: ({ open, title }: { open: boolean; title: string }) => (open ? <div>confirm delete {title}</div> : null),
}));
vi.mock('../shared/SharedBadge', () => ({ SharedBadge: () => null }));
vi.mock('../shared/ShareDialog', () => ({ ShareDialog: () => null }));

const DEAL = {
  id: 'd1', title: 'Renewal Q4', userId: 'u1', partnerId: 'p1', customerId: 'c1', products: null,
  status: 'APPROVED', expiryDate: null, notes: null,
  partner: { id: 'p1', name: 'IBM', registrationUrl: null }, customer: { id: 'c1', name: 'Bemyapp', logoUrl: null },
  createdAt: '', updatedAt: '',
};

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(dealsApi.getAll).mockResolvedValue({ data: { data: [DEAL], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } } } as never);
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/pursuits']}>
      <Routes><Route path="*" element={<><DealsPage embedded /><Where /></>} /></Routes>
    </MemoryRouter>,
  );
}

describe('DealsPage rows', () => {
  it('opens the deal when the row is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    const cell = await screen.findByText('Approved');
    await user.click(cell);
    expect(screen.getByText('editing Renewal Q4')).toBeInTheDocument();
  });

  it('keeps delete in the row menu', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Renewal Q4');
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for Renewal Q4' }));
    const items = await screen.findAllByRole('menuitem', { hidden: true });
    await user.click(items.find((i) => i.textContent?.includes('Delete'))!);
    expect(screen.getByText('confirm delete Renewal Q4')).toBeInTheDocument();
    expect(screen.queryByText(/^editing/)).not.toBeInTheDocument();
  });

  it('sends the company link to the company, not into the deal', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('Bemyapp'));
    expect(screen.getByTestId('where')).toHaveTextContent('/customers/c1');
    expect(screen.queryByText(/^editing/)).not.toBeInTheDocument();
  });
});
