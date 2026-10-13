import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DealCreateModal } from './DealCreateModal';

/** "New deal" from a company's page starts filed under that company. */

vi.mock('../../api/dealPartners', () => ({ dealPartnersApi: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) } }));
vi.mock('../../api/deals', () => ({ dealsApi: { create: vi.fn(), update: vi.fn() } }));
vi.mock('../../api/customers', () => ({
  customersApi: {
    getAll: vi.fn().mockResolvedValue({ data: { data: [] } }),
    getById: vi.fn().mockResolvedValue({ data: { data: { id: 'c1', name: 'Attijariwafa' } } }),
  },
}));

describe('DealCreateModal', () => {
  it('starts on the company it was opened from', async () => {
    render(<DealCreateModal open onClose={vi.fn()} onCreated={vi.fn()} initialCustomerId="c1" />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Customer' })).toHaveValue('Attijariwafa'));
  });

  it('starts on no company otherwise', async () => {
    render(<DealCreateModal open onClose={vi.fn()} onCreated={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('combobox', { name: 'Customer' })).toHaveValue('');
  });
});
