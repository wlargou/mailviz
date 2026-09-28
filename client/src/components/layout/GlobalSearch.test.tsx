import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { GlobalSearch } from './GlobalSearch';
import { searchApi, type SearchResults } from '../../api/search';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});
vi.mock('../../api/search', () => ({ searchApi: { search: vi.fn() } }));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

const RESULTS: SearchResults = {
  emails: [{ id: 'e1', threadId: 't', subject: 'RE: BKAM AO 70', from: 'x@bkam.ma', fromName: 'Achats', snippet: null, receivedAt: '2026-09-26T09:00:00.000Z' }],
  tasks: [],
  events: [],
  customers: [{ id: 'c1', name: 'BKAM', company: null, email: null, logoUrl: null }],
  contacts: [],
  deals: [],
  rfps: [
    {
      id: 'r1',
      name: 'Refonte de la plateforme matérielle AIX',
      reference: '70/AOO/BKAM/2026',
      status: 'WORKING',
      deadlineAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      customer: { id: 'c1', name: 'BKAM' },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchApi.search).mockResolvedValue(axiosOk({ data: RESULTS }) as never);
});

describe('GlobalSearch', () => {
  it('finds tenders, lists them first, and opens the tender', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GlobalSearch />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('searchbox'), 'BKAM');
    const options = await screen.findAllByRole('option');
    // Before the mail that mentions it, and before the company.
    expect(options[0]).toHaveTextContent('Refonte de la plateforme matérielle AIX');
    expect(options[0]).toHaveTextContent('70/AOO/BKAM/2026');
    expect(options[0]).toHaveTextContent(/due in 2 days/);

    await user.click(options[0]);
    expect(navigateSpy).toHaveBeenCalledWith('/rfps/r1');
  });

  it('can be narrowed to RFPs alone', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GlobalSearch />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('combobox', { name: /Search scope/i }));
    await user.click(await screen.findByRole('option', { name: 'RFPs' }));
    await user.type(screen.getByRole('searchbox'), 'BKAM');

    await waitFor(() => expect(screen.getAllByRole('option').filter((o) => o.closest('.global-search__panel'))).toHaveLength(1));
  });
});
