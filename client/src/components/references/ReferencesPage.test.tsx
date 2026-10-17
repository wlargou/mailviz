import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ReferencesPage, apiParams } from './ReferencesPage';
import { clientReferencesApi } from '../../api/clientReferences';
import { makeReference } from './testFixtures';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('../../api/clientReferences', () => ({
  clientReferencesApi: {
    getAll: vi.fn(),
    getFacets: vi.fn(),
    getIds: vi.fn(),
  },
}));

const FACETS = {
  total: 2,
  needsReview: 1,
  technologyTags: [
    { tag: 'IBM Power', count: 2 },
    { tag: 'VMware', count: 0 },
  ],
  prestationTags: [{ tag: 'Migration', count: 1 }],
  partners: [{ name: 'IBM', count: 2 }],
  companies: [{ id: 'c1', name: 'CMI', count: 1 }],
};

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.search}</p>;
}

function renderAt(url = '/deals?tab=references') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/deals"
          element={
            <>
              <ReferencesPage />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(clientReferencesApi.getAll).mockReset().mockResolvedValue({
    data: { data: [makeReference(), makeReference({ id: 'ref2', customerName: 'Tanger Med', needsReview: false, documentType: 'FICHE_PROJET', consortiumPartners: ['Corporate Software'] })], meta: { page: 1, limit: 50, total: 2, totalPages: 1 } },
  } as never);
  vi.mocked(clientReferencesApi.getFacets).mockReset().mockResolvedValue({ data: { data: FACETS } } as never);
  navigateSpy.mockReset();
});

describe('apiParams', () => {
  it('turns the URL’s filters into the API’s parameters', () => {
    const p = new URLSearchParams('tab=references&q=sauvegarde&tags=IBM Power,VMware&min=1 000 000&since=3&appreciation=POSITIVE&signer=role&type=FICHE_PROJET&status=IN_PROGRESS&company=c1&partner=IBM&review=true&sort=effectiveDate&order=asc');
    expect(apiParams(p)).toEqual({
      search: 'sauvegarde',
      tags: 'IBM Power,VMware',
      minAmount: '1000000',
      sinceYears: '3',
      appreciation: 'POSITIVE',
      signerRole: 'true',
      documentType: 'FICHE_PROJET',
      workStatus: 'IN_PROGRESS',
      customerId: 'c1',
      partner: 'IBM',
      needsReview: 'true',
      sortBy: 'effectiveDate',
      sortOrder: 'asc',
    });
  });

  it('drops an amount that is not one, rather than sending it', () => {
    expect(apiParams(new URLSearchParams('min=12abc'))).toEqual({});
  });
});

describe('ReferencesPage', () => {
  it('lists the references with what sets each apart', async () => {
    renderAt();
    expect(await screen.findByRole('button', { name: 'CMI — Centre Monétique Interbancaire' })).toBeInTheDocument();
    expect(screen.getAllByText('16 090 620 DH')).toHaveLength(2);
    // Both rows are the same letter but for their flags.
    expect(screen.getAllByText('Satisfaction')).toHaveLength(2);
    expect(screen.getByText('Fiche projet')).toBeInTheDocument();
    expect(screen.getByText('Consortium')).toBeInTheDocument();
    expect(screen.getAllByText('To review').length).toBeGreaterThan(0);
    expect(document.querySelector('.references-applied__count')?.textContent).toMatch(/^2 references · 1 to review/);
  });

  it('asks the API with the filters in the URL, and shows each as a tag that removes it', async () => {
    const user = userEvent.setup();
    renderAt('/deals?tab=references&tags=IBM%20Power&since=3&signer=role');
    await screen.findByRole('button', { name: 'CMI — Centre Monétique Interbancaire' });

    expect(vi.mocked(clientReferencesApi.getAll)).toHaveBeenLastCalledWith(
      expect.objectContaining({ tags: 'IBM Power', sinceYears: '3', signerRole: 'true', page: '1', limit: '50' }),
    );

    await user.click(screen.getByRole('button', { name: /Remove Last 3 years/ }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).not.toContain('since='));
    expect(screen.getByTestId('where').textContent).toContain('tags=IBM+Power');

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?tab=references'));
    expect(vi.mocked(clientReferencesApi.getAll)).toHaveBeenLastCalledWith({ page: '1', limit: '50' });
  });

  it('opens a reference with the list’s query, so its page can step through the same list', async () => {
    const user = userEvent.setup();
    renderAt('/deals?tab=references&tags=IBM%20Power');
    await user.click(await screen.findByRole('button', { name: 'CMI — Centre Monétique Interbancaire' }));

    expect(navigateSpy).toHaveBeenCalledWith('/references/ref1', {
      state: { query: { tags: 'IBM Power' }, back: '/deals?tab=references&tags=IBM+Power' },
    });
  });

  it('writes the typed search and minimum amount to the URL, and asks the API with them', async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole('button', { name: 'CMI — Centre Monétique Interbancaire' });

    await user.type(screen.getByPlaceholderText(/Search customer, project/), 'sauvegarde');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('q=sauvegarde'));
    await user.type(screen.getByRole('textbox', { name: 'Minimum amount (HT)' }), '1 000 000');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('min=1+000+000'));
    await waitFor(() =>
      expect(vi.mocked(clientReferencesApi.getAll)).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'sauvegarde', minAmount: '1000000' })),
    );
  });

  it('keeps the page when nothing but spaces was typed', async () => {
    const user = userEvent.setup();
    renderAt('/deals?tab=references&page=2');
    await screen.findByRole('button', { name: 'CMI — Centre Monétique Interbancaire' });
    await user.type(screen.getByPlaceholderText(/Search customer, project/), '   ');
    await new Promise((r) => setTimeout(r, 450));
    expect(screen.getByTestId('where').textContent).toContain('page=2');
  });

  it('offers the review backlog as a filter', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole('button', { name: '1 to review' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('review=true'));
  });
});
