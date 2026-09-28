import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { RfpDetailPage } from './RfpDetailPage';
import { rfpsApi } from '../../api/rfps';
import { useAuthStore } from '../../store/authStore';
import type { RfpDetail, RfpFolder, RfpItem } from '../../types/rfp';

vi.mock('../../api/rfps', () => ({
  rfpsApi: {
    getAll: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    uploadDocument: vi.fn(), deleteDocument: vi.fn(), getCatalogue: vi.fn(), getPeople: vi.fn(),
    createLot: vi.fn(), updateLot: vi.fn(), deleteLot: vi.fn(),
    createFolder: vi.fn(), deleteFolder: vi.fn(),
    createItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(), uploadItemDocument: vi.fn(),
    shareRfp: vi.fn(), unshareRfp: vi.fn(), getRfpShares: vi.fn(),
    documentUrl: (r: string, d: string) => `/api/v1/rfps/${r}/documents/${d}`,
    documentInlineUrl: (r: string, d: string) => `/api/v1/rfps/${r}/documents/${d}?inline=true`,
  },
}));

// The edit form fetches companies; it is not what is under test here.
vi.mock('./RfpFormPanel', () => ({ RfpFormPanel: () => null }));

vi.mock('../shared/AttachmentPreviewModal', () => ({
  AttachmentPreviewModal: ({ open, items, index }: { open: boolean; items: Array<{ file: { filename: string } }>; index: number }) =>
    open && items[index] ? <div data-testid="preview">{items[index].file.filename}</div> : null,
}));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

function item(id: string, title: string, status: RfpItem['status'] = 'TODO', documents: RfpItem['documents'] = []): RfpItem {
  return { id, folderId: '', title, status, notes: null, position: 0, updatedAt: '2026-09-28T09:00:00.000Z', documents, verifications: [] };
}

function folder(id: string, title: string, items: RfpItem[], lot: { id: string; number: number; title: string } | null = null): RfpFolder {
  return {
    id,
    rfpId: 'r1',
    lotId: lot?.id ?? null,
    lot,
    kind: lot ? 'OFFRE_TECHNIQUE' : 'ADMINISTRATIF',
    title,
    position: 0,
    items: items.map((i) => ({ ...i, folderId: id })),
  };
}

const LOT1 = { id: 'l1', rfpId: 'r1', number: 1, title: 'Infrastructure', budget: 1500000 };
const LOT2 = { id: 'l2', rfpId: 'r1', number: 2, title: 'Support', budget: 400000 };

function makeRfp(overrides: Partial<RfpDetail> = {}): RfpDetail {
  return {
    id: 'r1',
    name: 'Maintenance SIMPL',
    reference: '27/2026/DGI',
    customerId: null,
    customer: { id: 'c1', name: 'DGI', logoUrl: null },
    deadlineAt: '2026-12-09T10:00:00.000Z',
    submissionFormat: 'PORTAL',
    portalUrl: 'https://www.marchespublics.gov.ma/',
    isGoe: true,
    budget: 1900000,
    status: 'WORKING',
    notes: null,
    userId: 'me',
    createdAt: '',
    updatedAt: '',
    documents: [],
    lots: [LOT1],
    verifiers: [],
    folders: [
      folder('f1', 'Dossier administratif', [
        item('i1', 'Attestation fiscale', 'READY'),
        item('i2', 'Attestation CNSS', 'TODO'),
        // Not applicable is neither done nor left to do.
        item('i3', 'Certificat du registre de commerce', 'NOT_APPLICABLE'),
      ]),
    ],
    ...overrides,
  };
}

function serve(rfp: RfpDetail) {
  vi.mocked(rfpsApi.getById).mockResolvedValue(axiosOk({ data: rfp }) as never);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/rfps/r1']}>
      <Routes>
        <Route path="/rfps/:id" element={<RfpDetailPage />} />
        <Route path="/rfps" element={<div>The register</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'me', email: 'me@test', name: 'Me', avatarUrl: null } });
  vi.mocked(rfpsApi.getCatalogue).mockResolvedValue(axiosOk({ data: [] }) as never);
  vi.mocked(rfpsApi.getPeople).mockResolvedValue(axiosOk({ data: [] }) as never);
});

describe('RfpDetailPage', () => {
  it('counts down to a live deadline, and not to a finished one', async () => {
    const deadlineAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
    serve(makeRfp({ deadlineAt }));
    const { unmount } = renderPage();
    expect(await screen.findByText(/^in 5 days · \w+day$/)).toBeInTheDocument();
    unmount();

    serve(makeRfp({ deadlineAt, status: 'WON' }));
    renderPage();
    await screen.findByRole('heading', { name: 'Maintenance SIMPL' });
    expect(screen.queryByText(/in 5 days/)).toBeNull();
  });

  it('shows the tender, and how much of the response is ready', async () => {
    serve(makeRfp());
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Maintenance SIMPL' })).toBeInTheDocument();
    expect(screen.getByText('27/2026/DGI · DGI')).toBeInTheDocument();
    expect(screen.getByText('1 900 000 DH')).toBeInTheDocument();
    // Three pieces, one of which does not apply: one of two is ready.
    expect(screen.getByText('1 of 2 pieces ready')).toBeInTheDocument();
    expect(screen.getByText('1/2 ready')).toBeInTheDocument();
  });

  it('says so when the tender does not exist or is not shared', async () => {
    vi.mocked(rfpsApi.getById).mockRejectedValue(
      new AxiosError('nf', 'ERR', undefined, undefined, {
        status: 404, data: {}, statusText: 'Not Found', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() },
      } as AxiosResponse),
    );
    renderPage();

    expect(await screen.findByText('RFP not found')).toBeInTheDocument();
  });

  it('moves a piece forward at once, and back if the server refuses', async () => {
    serve(makeRfp());
    let reject!: (e: unknown) => void;
    vi.mocked(rfpsApi.updateItem).mockReturnValue(new Promise((_, r) => (reject = r)) as never);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('1/2 ready');

    await user.click(screen.getByRole('combobox', { name: 'Status of Attestation CNSS' }));
    await user.click(await screen.findByRole('option', { name: 'Ready' }));

    // Before the server has answered.
    expect(screen.getByText('2/2 ready')).toBeInTheDocument();
    expect(rfpsApi.updateItem).toHaveBeenCalledWith('r1', 'i2', { status: 'READY' });

    reject(new Error('network'));
    await waitFor(() => expect(screen.getByText('1/2 ready')).toBeInTheDocument());
  });

  it('adds a piece to a dossier and re-reads the tender', async () => {
    serve(makeRfp());
    vi.mocked(rfpsApi.createItem).mockResolvedValue(axiosOk({ data: item('i9', 'Kbis') }) as never);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('1/2 ready');

    await user.type(screen.getByLabelText('New piece for Dossier administratif'), '  Attestation d’assurance  ');
    await user.click(screen.getByRole('button', { name: 'Add piece' }));

    await waitFor(() => expect(rfpsApi.createItem).toHaveBeenCalledWith('r1', 'f1', 'Attestation d’assurance'));
    await waitFor(() => expect(rfpsApi.getById).toHaveBeenCalledTimes(2));
  });

  it("opens a piece's file in the preview", async () => {
    serve(
      makeRfp({
        folders: [
          folder('f1', 'Offre technique', [
            item('i1', 'CV des intervenants', 'IN_PROGRESS', [
              { id: 'd1', rfpId: 'r1', kind: 'OTHER', filename: 'CV Amine.pdf', mimeType: 'application/pdf', size: 10, version: 1, uploadedById: null, createdAt: '' },
              { id: 'd2', rfpId: 'r1', kind: 'OTHER', filename: 'CV Salma.pdf', mimeType: 'application/pdf', size: 10, version: 2, uploadedById: null, createdAt: '' },
            ]),
          ]),
        ],
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'CV Salma.pdf' }));
    expect(screen.getByTestId('preview')).toHaveTextContent('CV Salma.pdf');
  });

  it("groups the offers under their lot when there is more than one", async () => {
    serve(
      makeRfp({
        lots: [LOT1, LOT2],
        folders: [
          folder('f1', 'Dossier administratif', [item('i1', 'Attestation fiscale')]),
          folder('f2', 'Offre technique — Lot 1', [item('i2', 'CV des intervenants')], LOT1),
          folder('f3', 'Offre technique — Lot 2', [item('i3', 'Offre de support')], LOT2),
        ],
      }),
    );
    renderPage();

    const lot2 = (await screen.findByRole('heading', { name: 'Lot 2 — Support' })).closest('.rfp-response__group')! as HTMLElement;
    expect(within(lot2).getByText('Offre technique — Lot 2')).toBeInTheDocument();
    expect(within(lot2).queryByText('Offre technique — Lot 1')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Whole tender' })).toBeInTheDocument();
  });

  it('adds a one-off dossier to the whole tender unless a lot is picked', async () => {
    serve(makeRfp({ lots: [LOT1, LOT2] }));
    vi.mocked(rfpsApi.getCatalogue).mockResolvedValue(
      axiosOk({
        data: [
          { kind: 'OFFRE_TECHNIQUE', label: 'Offre technique', perLot: true, defaultItems: ['CV des intervenants'] },
          { kind: 'OTHER', label: 'Autre', perLot: false, defaultItems: [] },
        ],
      }) as never,
    );
    vi.mocked(rfpsApi.createFolder).mockResolvedValue(axiosOk({ data: folder('f9', 'Échantillons', []) }) as never);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add dossier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add dossier' });
    // "Autre" is for what the RC invents — usually once for the tender.
    expect(within(dialog).getByRole('combobox', { name: /Lot/ })).toHaveTextContent('Whole tender');
    await user.type(within(dialog).getByLabelText('Title'), 'Échantillons');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(rfpsApi.createFolder).toHaveBeenCalledWith('r1', { kind: 'OTHER', lotId: null, title: 'Échantillons', prefill: false }),
    );
  });

  it('keeps one lot, and totals the budgets of several', async () => {
    serve(makeRfp({ lots: [LOT1, LOT2] }));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Lots (2)' }));
    const table = screen.getByRole('table', { name: 'Lots' });
    expect(within(table).getByText('1 500 000 DH')).toBeInTheDocument();
    expect(within(table).getByText('1 900 000 DH')).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Remove lot 2' })).toBeEnabled();
  });

  it('will not offer to remove the only lot', async () => {
    serve(makeRfp());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Lots (1)' }));
    expect(screen.getByRole('button', { name: 'A tender keeps at least one lot' })).toBeDisabled();
  });

  it('adds a lot with its budget', async () => {
    serve(makeRfp());
    vi.mocked(rfpsApi.createLot).mockResolvedValue(axiosOk({ data: LOT2 }) as never);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Lots (1)' }));
    await user.click(screen.getByRole('button', { name: 'Add lot' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add lot 2' });
    await user.clear(within(dialog).getByLabelText('Title'));
    await user.type(within(dialog).getByLabelText('Title'), 'Support');
    await user.type(within(dialog).getByLabelText('Budget (MAD)'), '400000');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(rfpsApi.createLot).toHaveBeenCalledWith('r1', { title: 'Support', budget: 400000 }));
  });
});
