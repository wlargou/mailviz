import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { RfpsPage, deadlineTone } from './RfpsPage';
import { rfpsApi } from '../../api/rfps';
import type { Rfp } from '../../types/rfp';

vi.mock('../../api/rfps', () => ({
  rfpsApi: {
    getAll: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    uploadDocument: vi.fn(), deleteDocument: vi.fn(),
    documentUrl: (r: string, d: string) => `/api/v1/rfps/${r}/documents/${d}`,
    documentInlineUrl: (r: string, d: string) => `/api/v1/rfps/${r}/documents/${d}?inline=true`,
  },
}));

vi.mock('../shared/AttachmentPreviewModal', () => ({
  AttachmentPreviewModal: ({ open, items, index }: { open: boolean; items: Array<{ file: { filename: string }; inlineUrl: string }>; index: number }) =>
    open && items[index] ? (
      <div data-testid="preview">
        <span data-testid="preview-name">{items[index].file.filename}</span>
        <span data-testid="preview-inline">{items[index].inlineUrl}</span>
        <span data-testid="preview-count">{items.length}</span>
      </div>
    ) : null,
}));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

function makeRfp(overrides: Partial<Rfp> = {}): Rfp {
  return {
    id: 'r1',
    name: 'Refonte de la plateforme matérielle AIX',
    reference: '70/AOO/BKAM/2026',
    customerId: 'c1',
    customer: { id: 'c1', name: 'Bank Al-Maghrib', logoUrl: null },
    deadlineAt: '2026-12-09T10:00:00.000Z',
    submissionFormat: 'PORTAL',
    portalUrl: 'https://portailachats.bankalmaghrib.ma/',
    isGoe: true,
    budget: 12500000,
    status: 'OPEN',
    notes: null,
    userId: 'me',
    createdAt: '',
    updatedAt: '',
    documents: [],
    ...overrides,
  };
}

const DOCS = [
  { id: 'd1', rfpId: 'r1', kind: 'RFP' as const, filename: 'RC.pdf', mimeType: 'application/pdf', size: 10, createdAt: '' },
  { id: 'd2', rfpId: 'r1', kind: 'AVIS' as const, filename: 'Avis.pdf', mimeType: 'application/pdf', size: 10, createdAt: '' },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <RfpsPage />
    </MemoryRouter>
  );
}

function serve(rfps: Rfp[]) {
  vi.mocked(rfpsApi.getAll).mockResolvedValue(axiosOk({ data: rfps, meta: { page: 1, limit: 20, total: rfps.length, totalPages: 1 } }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The deadline is the only urgent thing in the register, and urgency has to
 * stop when the tender does: a bid won last month must not sit in the table
 * coloured like a missed deadline.
 */
describe('deadlineTone', () => {
  const now = new Date('2026-09-01T09:00:00.000Z').getTime();

  it('separates overdue, due soon and comfortable', () => {
    expect(deadlineTone('2026-08-31T09:00:00.000Z', 'OPEN', now)).toBe('overdue');
    expect(deadlineTone('2026-09-05T09:00:00.000Z', 'WORKING', now)).toBe('soon');
    expect(deadlineTone('2026-09-08T08:59:00.000Z', 'OPEN', now)).toBe('soon');
    expect(deadlineTone('2026-10-01T09:00:00.000Z', 'OPEN', now)).toBe('normal');
  });

  it('never marks a finished tender urgent, however old its deadline', () => {
    for (const status of ['WON', 'LOST', 'NO_BID', 'CANCELLED'] as const) {
      expect(deadlineTone('2020-01-01T09:00:00.000Z', status, now)).toBe('normal');
    }
    // Still live, same date: urgent.
    expect(deadlineTone('2020-01-01T09:00:00.000Z', 'SUBMITTED', now)).toBe('overdue');
  });
});

describe('RfpsPage', () => {
  it('shows every field of the register for a row', async () => {
    serve([makeRfp({ documents: [{ id: 'd1', rfpId: 'r1', kind: 'RFP', filename: 'CPS.pdf', mimeType: 'application/pdf', size: 1024, createdAt: '' }] })]);
    renderPage();

    // By the reference: the tender's name appears on the row button and again
    // inside each action button's description.
    const row = (await screen.findByText('70/AOO/BKAM/2026')).closest('tr')!;
    expect(within(row).getByRole('button', { name: 'Refonte de la plateforme matérielle AIX' })).toBeInTheDocument();
    expect(within(row).getByText('9 Dec 2026')).toBeInTheDocument();
    // The buying organisation — a tender is recognised by who it is from at
    // least as often as by its reference.
    expect(within(row).getByText('Bank Al-Maghrib')).toBeInTheDocument();
    expect(within(row).getByText('Portal')).toBeInTheDocument();
    expect(within(row).getByText('GOE')).toBeInTheDocument();
    expect(within(row).getByText(/12[\s  ]?500[\s  ]?000 DH/)).toBeInTheDocument();
    expect(within(row).getByText('Open')).toBeInTheDocument();
    expect(within(row).getByText('1')).toBeInTheDocument();
    // The portal is a different one for every buyer, so the row links to it.
    expect(within(row).getByRole('button', { name: /Open the buyer's portal/ })).toBeInTheDocument();
  });

  it('opens the company from the row', async () => {
    serve([makeRfp()]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Bank Al-Maghrib'));

    expect(navigateSpy).toHaveBeenCalledWith('/customers/c1');
  });

  it('shows a dash when a tender has no company', async () => {
    serve([makeRfp({ customerId: null, customer: null })]);
    renderPage();

    const row = (await screen.findByText('70/AOO/BKAM/2026')).closest('tr')!;
    expect(within(row).queryByText('Bank Al-Maghrib')).toBeNull();
  });

  it('shows no budget for a private buyer — only public ones publish an estimate', async () => {
    serve([makeRfp({ isGoe: false, budget: null, submissionFormat: 'PAPER', portalUrl: null })]);
    renderPage();

    const row = (await screen.findByText('70/AOO/BKAM/2026')).closest('tr')!;
    expect(within(row).getByText('Paper')).toBeInTheDocument();
    expect(within(row).queryByText('GOE')).toBeNull();
    expect(within(row).queryByRole('button', { name: /portal/i })).toBeNull();
  });

  it('opens on live tenders only, and an explicit status replaces that scope', async () => {
    serve([makeRfp()]);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(rfpsApi.getAll).toHaveBeenCalled());
    expect(vi.mocked(rfpsApi.getAll).mock.calls[0][0]).toMatchObject({ scope: 'open', sortBy: 'deadlineAt', sortOrder: 'asc' });

    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(screen.getByRole('combobox', { name: /Status/i }));
    await user.click(await screen.findByRole('option', { name: 'Won' }));

    await waitFor(() => {
      const last = vi.mocked(rfpsApi.getAll).mock.calls.at(-1)![0]!;
      expect(last.status).toBe('WON');
      // Asking for a finished status while also hiding finished ones would
      // always return nothing.
      expect(last.scope).toBeUndefined();
    });
  });

  it('opens the dossier from the document count, on the first document', async () => {
    // The documents are the reason to open a tender at all; reaching them
    // used to mean opening the edit panel and scrolling to the bottom.
    serve([makeRfp({ documents: DOCS })]);
    const user = userEvent.setup();
    renderPage();

    const count = await screen.findByRole('button', { name: /Preview 2 documents/ });
    expect(screen.queryByTestId('preview')).toBeNull();

    await user.click(count);

    expect(screen.getByTestId('preview-name')).toHaveTextContent('RC.pdf');
    expect(screen.getByTestId('preview-inline')).toHaveTextContent('/api/v1/rfps/r1/documents/d1?inline=true');
    // The whole dossier, so the arrows can step through it.
    expect(screen.getByTestId('preview-count')).toHaveTextContent('2');
  });

  it('offers nothing to open when a tender has no documents', async () => {
    serve([makeRfp({ documents: [] })]);
    renderPage();

    await screen.findByText('70/AOO/BKAM/2026');
    expect(screen.queryByRole('button', { name: /Preview/ })).toBeNull();
  });

  it('warns that the dossier goes too, before deleting a tender', async () => {
    serve([makeRfp({ documents: DOCS })]);
    vi.mocked(rfpsApi.delete).mockResolvedValue(axiosOk({}) as never);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Delete Refonte/ }));
    expect(await screen.findByText(/Its 2 documents will be deleted too/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(rfpsApi.delete).toHaveBeenCalledWith('r1'));
  });
});
