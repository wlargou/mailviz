import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { RfpsPage, deadlineTone } from './RfpsPage';
import { rfpsApi } from '../../api/rfps';
import type { Rfp } from '../../types/rfp';

vi.mock('../../api/rfps', () => ({
  rfpsApi: { getAll: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), uploadDocument: vi.fn(), deleteDocument: vi.fn(), documentUrl: (r: string, d: string) => `/api/v1/rfps/${r}/documents/${d}` },
}));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

function makeRfp(overrides: Partial<Rfp> = {}): Rfp {
  return {
    id: 'r1',
    name: 'Refonte de la plateforme matérielle AIX',
    reference: '70/AOO/BKAM/2026',
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
    render(<RfpsPage />);

    // By the reference: the tender's name appears on the row button and again
    // inside each action button's description.
    const row = (await screen.findByText('70/AOO/BKAM/2026')).closest('tr')!;
    expect(within(row).getByRole('button', { name: 'Refonte de la plateforme matérielle AIX' })).toBeInTheDocument();
    expect(within(row).getByText('9 Dec 2026')).toBeInTheDocument();
    expect(within(row).getByText('Portal')).toBeInTheDocument();
    expect(within(row).getByText('GOE')).toBeInTheDocument();
    expect(within(row).getByText(/12[\s  ]?500[\s  ]?000 DH/)).toBeInTheDocument();
    expect(within(row).getByText('Open')).toBeInTheDocument();
    expect(within(row).getByText('1')).toBeInTheDocument();
    // The portal is a different one for every buyer, so the row links to it.
    expect(within(row).getByRole('button', { name: /Open the buyer's portal/ })).toBeInTheDocument();
  });

  it('shows no budget for a private buyer — only public ones publish an estimate', async () => {
    serve([makeRfp({ isGoe: false, budget: null, submissionFormat: 'PAPER', portalUrl: null })]);
    render(<RfpsPage />);

    const row = (await screen.findByText('70/AOO/BKAM/2026')).closest('tr')!;
    expect(within(row).getByText('Paper')).toBeInTheDocument();
    expect(within(row).queryByText('GOE')).toBeNull();
    expect(within(row).queryByRole('button', { name: /portal/i })).toBeNull();
  });

  it('opens on live tenders only, and an explicit status replaces that scope', async () => {
    serve([makeRfp()]);
    const user = userEvent.setup();
    render(<RfpsPage />);

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

  it('warns that the dossier goes too, before deleting a tender', async () => {
    serve([makeRfp({ documents: [
      { id: 'd1', rfpId: 'r1', kind: 'RFP', filename: 'RC.pdf', mimeType: 'application/pdf', size: 10, createdAt: '' },
      { id: 'd2', rfpId: 'r1', kind: 'AVIS', filename: 'Avis.pdf', mimeType: 'application/pdf', size: 10, createdAt: '' },
    ] })]);
    vi.mocked(rfpsApi.delete).mockResolvedValue(axiosOk({}) as never);
    const user = userEvent.setup();
    render(<RfpsPage />);

    await user.click(await screen.findByRole('button', { name: /Delete Refonte/ }));
    expect(await screen.findByText(/Its 2 documents will be deleted too/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(rfpsApi.delete).toHaveBeenCalledWith('r1'));
  });
});
