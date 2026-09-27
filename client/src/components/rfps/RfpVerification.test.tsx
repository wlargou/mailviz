import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { RfpDetailPage } from './RfpDetailPage';
import { rfpsApi } from '../../api/rfps';
import { useAuthStore } from '../../store/authStore';
import type { RfpDetail, RfpDocument, RfpItem, RfpItemVerification, RfpPerson, RfpVerifier } from '../../types/rfp';

vi.mock('../../api/rfps', () => ({
  rfpsApi: {
    getAll: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    uploadDocument: vi.fn(), deleteDocument: vi.fn(), getCatalogue: vi.fn(),
    createLot: vi.fn(), updateLot: vi.fn(), deleteLot: vi.fn(),
    createFolder: vi.fn(), deleteFolder: vi.fn(),
    createItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(), uploadItemDocument: vi.fn(),
    setVerifiers: vi.fn(), decide: vi.fn(), withdrawDecision: vi.fn(),
    shareRfp: vi.fn(), unshareRfp: vi.fn(), getRfpShares: vi.fn(),
    documentUrl: (r: string, d: string) => `/api/v1/rfps/${r}/documents/${d}`,
    documentInlineUrl: (r: string, d: string) => `/api/v1/rfps/${r}/documents/${d}?inline=true`,
  },
}));

vi.mock('./RfpFormPanel', () => ({ RfpFormPanel: () => null }));
vi.mock('../shared/AttachmentPreviewModal', () => ({
  AttachmentPreviewModal: ({ open, items, index }: { open: boolean; items: Array<{ file: { filename: string } }>; index: number }) =>
    open && items[index] ? <div data-testid="preview">{items[index].file.filename}</div> : null,
}));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

const ME: RfpPerson = { id: 'me', name: 'Walid', email: 'walid@powerm.ma', avatarUrl: null };
const SALMA: RfpPerson = { id: 'u2', name: 'Salma Bennani', email: 'salma@powerm.ma', avatarUrl: null };

const verifier = (p: RfpPerson): RfpVerifier => ({ id: `v-${p.id}`, rfpId: 'r1', userId: p.id, createdAt: '', user: p });

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

function version(n: number, uploadedBy: RfpPerson | null, filename = `Attestation v${n}.pdf`): RfpDocument {
  return {
    id: `d${n}`, rfpId: 'r1', kind: 'OTHER', filename, mimeType: 'application/pdf', size: 2048,
    version: n, uploadedById: uploadedBy?.id ?? null, uploadedBy, createdAt: hoursAgo(10 - n),
  };
}

function decision(p: RfpPerson, documentId: string, d: RfpItemVerification['decision'] = 'APPROVED', comment: string | null = null): RfpItemVerification {
  return { id: `x-${p.id}`, itemId: 'i1', userId: p.id, documentId, decision: d, comment, createdAt: hoursAgo(1), updatedAt: hoursAgo(1), user: p };
}

function piece(overrides: Partial<RfpItem> = {}): RfpItem {
  return {
    id: 'i1', folderId: 'f1', title: 'Attestation fiscale', status: 'IN_PROGRESS', notes: null, position: 0,
    updatedAt: hoursAgo(1), documents: [version(1, null), version(2, SALMA)], verifications: [], ...overrides,
  };
}

function makeRfp(item: RfpItem, verifiers: RfpVerifier[] = [verifier(ME), verifier(SALMA)], overrides: Partial<RfpDetail> = {}): RfpDetail {
  return {
    id: 'r1', name: 'Maintenance SIMPL', reference: '27/2026/DGI', customerId: null, customer: null,
    deadlineAt: '2026-12-09T10:00:00.000Z', submissionFormat: 'PORTAL', portalUrl: null, isGoe: false, budget: null,
    status: 'WORKING', notes: null, userId: 'me', user: { id: 'me', name: 'Walid', email: 'walid@powerm.ma' },
    createdAt: '', updatedAt: '', documents: [], lots: [{ id: 'l1', rfpId: 'r1', number: 1, title: 'Lot unique', budget: null }],
    verifiers,
    folders: [{ id: 'f1', rfpId: 'r1', lotId: null, lot: null, kind: 'ADMINISTRATIF', title: 'Dossier administratif', position: 0, items: [item] }],
    ...overrides,
  };
}

const serve = (rfp: RfpDetail) => vi.mocked(rfpsApi.getById).mockResolvedValue(axiosOk({ data: rfp }) as never);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/rfps/r1']}>
      <Routes>
        <Route path="/rfps/:id" element={<RfpDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Open the dossier's accordion row, where the pieces are. */
async function openDossier(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Dossier administratif/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'me', email: 'walid@powerm.ma', name: 'Walid', avatarUrl: null } });
  vi.mocked(rfpsApi.getCatalogue).mockResolvedValue(axiosOk({ data: [] }) as never);
});

describe('a piece row', () => {
  it('shows the current version, who uploaded it and when', async () => {
    serve(makeRfp(piece()));
    const user = userEvent.setup();
    renderPage();
    await openDossier(user);

    const row = screen.getByRole('button', { name: 'Attestation fiscale' }).closest('li')!;
    // v2 is current; v1 is history, in the panel.
    expect(within(row).getByText('Attestation v2.pdf')).toBeInTheDocument();
    expect(within(row).queryByText('Attestation v1.pdf')).toBeNull();
    expect(within(row).getByText('v2')).toBeInTheDocument();
    expect(within(row).getByText(/Salma Bennani ·/)).toBeInTheDocument();
    expect(within(row).getByText(/8 hours ago/)).toBeInTheDocument();
  });

  it('counts only approvals of the current version', async () => {
    // Salma approved v1, which v2 has since replaced; only mine counts.
    serve(makeRfp(piece({ verifications: [decision(ME, 'd2'), decision(SALMA, 'd1')] })));
    const user = userEvent.setup();
    renderPage();
    await openDossier(user);

    expect(screen.getByLabelText('1 of 2 verifiers approved')).toBeInTheDocument();
  });

  it('offers Ready only once every verifier has approved', async () => {
    serve(makeRfp(piece({ verifications: [decision(ME, 'd2')] })));
    const user = userEvent.setup();
    renderPage();
    await openDossier(user);

    await user.click(screen.getByRole('combobox', { name: 'Status of Attestation fiscale' }));
    expect(await screen.findByRole('option', { name: 'Ready — after verification' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('leaves Ready to the user when there are no verifiers', async () => {
    serve(makeRfp(piece(), []));
    vi.mocked(rfpsApi.updateItem).mockResolvedValue(axiosOk({ data: {} }) as never);
    const user = userEvent.setup();
    renderPage();
    await openDossier(user);

    await user.click(screen.getByRole('combobox', { name: 'Status of Attestation fiscale' }));
    await user.click(await screen.findByRole('option', { name: 'Ready' }));

    expect(rfpsApi.updateItem).toHaveBeenCalledWith('r1', 'i1', { status: 'READY' });
  });

  it('uploads one file as the next version', async () => {
    serve(makeRfp(piece()));
    vi.mocked(rfpsApi.uploadItemDocument).mockResolvedValue(axiosOk({ data: version(3, ME) }) as never);
    const user = userEvent.setup();
    renderPage();
    await openDossier(user);

    const row = screen.getByRole('button', { name: 'Attestation fiscale' }).closest('li')!;
    const input = within(row).getByLabelText('New version') as HTMLInputElement;
    expect(input.multiple).toBe(false);
    await user.upload(input, new File(['%PDF'], 'v3.pdf', { type: 'application/pdf' }));

    await waitFor(() => expect(rfpsApi.uploadItemDocument).toHaveBeenCalledWith('r1', 'i1', expect.objectContaining({ name: 'v3.pdf' })));
    // Re-read: the server has moved the status and numbered the version.
    await waitFor(() => expect(rfpsApi.getById).toHaveBeenCalledTimes(2));
  });
});

describe('the piece panel', () => {
  async function openPanel(rfp: RfpDetail) {
    serve(rfp);
    const user = userEvent.setup();
    renderPage();
    await openDossier(user);
    await user.click(screen.getByRole('button', { name: 'Attestation fiscale' }));
    const panel = await screen.findByRole('complementary', { name: /Attestation fiscale/ });
    return { user, panel };
  }

  it('lists the versions newest first, with an unknown uploader said as such', async () => {
    const { panel } = await openPanel(makeRfp(piece()));

    const versions = within(within(panel).getByRole('list', { name: 'Versions' })).getAllByRole('listitem');
    expect(versions.map((v) => v.textContent)).toEqual([
      expect.stringContaining('Attestation v2.pdfSalma Bennani'),
      expect.stringContaining('Attestation v1.pdfUnknown uploader'),
    ]);
  });

  it("shows each verifier's standing, and what was asked of an earlier version", async () => {
    const { panel } = await openPanel(
      makeRfp(piece({ verifications: [decision(ME, 'd2'), decision(SALMA, 'd1', 'CHANGES_REQUESTED', 'Cachet manquant')] })),
    );

    const list = within(panel).getByRole('list', { name: 'Verifiers' });
    const [mine, hers] = within(list).getAllByRole('listitem');
    expect(within(mine).getByText('Approved')).toBeInTheDocument();
    expect(within(hers).getByText('Earlier version')).toBeInTheDocument();
    expect(within(hers).getByText(/Changes requested v1/)).toBeInTheDocument();
    expect(within(hers).getByText('Cachet manquant')).toBeInTheDocument();
  });

  it('approves the current version', async () => {
    vi.mocked(rfpsApi.decide).mockResolvedValue(axiosOk({ data: {} }) as never);
    const { user, panel } = await openPanel(makeRfp(piece()));

    await user.click(within(panel).getByRole('button', { name: 'Approve v2' }));

    await waitFor(() => expect(rfpsApi.decide).toHaveBeenCalledWith('r1', 'i1', { decision: 'APPROVED', comment: null }));
  });

  it('asks for changes only with a reason', async () => {
    vi.mocked(rfpsApi.decide).mockResolvedValue(axiosOk({ data: {} }) as never);
    const { user, panel } = await openPanel(makeRfp(piece()));

    await user.click(within(panel).getByRole('button', { name: 'Request changes' }));
    const send = within(panel).getByRole('button', { name: 'Request changes' });
    expect(send).toBeDisabled();
    await user.type(within(panel).getByLabelText('What needs to change in v2?'), '  Signature manquante ');
    await user.click(send);

    await waitFor(() =>
      expect(rfpsApi.decide).toHaveBeenCalledWith('r1', 'i1', { decision: 'CHANGES_REQUESTED', comment: 'Signature manquante' }),
    );
  });

  it('withdraws a decision already made', async () => {
    vi.mocked(rfpsApi.withdrawDecision).mockResolvedValue(axiosOk({}) as never);
    const { user, panel } = await openPanel(makeRfp(piece({ verifications: [decision(ME, 'd2')] })));

    expect(within(panel).getByRole('button', { name: 'Approve v2' })).toBeDisabled();
    await user.click(within(panel).getByRole('button', { name: 'Withdraw my decision' }));

    await waitFor(() => expect(rfpsApi.withdrawDecision).toHaveBeenCalledWith('r1', 'i1'));
  });

  it('offers no decision to someone who is not a verifier', async () => {
    const { panel } = await openPanel(makeRfp(piece(), [verifier(SALMA)]));

    expect(within(panel).queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Request changes' })).toBeNull();
  });
});

describe('the verifiers', () => {
  it('says how many pieces wait on me — not applicable ones and pieces without a file aside', async () => {
    const waiting = piece({ id: 'i1' });
    const stale = piece({ id: 'i2', title: 'Attestation CNSS', verifications: [{ ...decision(ME, 'd1'), itemId: 'i2' }] });
    const done = piece({ id: 'i3', title: 'RC signé', verifications: [{ ...decision(ME, 'd2'), itemId: 'i3' }] });
    const na = piece({ id: 'i4', title: 'Kbis', status: 'NOT_APPLICABLE' });
    const empty = piece({ id: 'i5', title: 'Caution', documents: [] });
    const rfp = makeRfp(waiting);
    rfp.folders[0].items = [waiting, stale, done, na, empty];
    serve(rfp);
    renderPage();

    expect(await screen.findByText('2 awaiting your verification')).toBeInTheDocument();
  });

  it('lets the owner choose them among the people the tender is shared with', async () => {
    serve(makeRfp(piece(), []));
    vi.mocked(rfpsApi.getRfpShares).mockResolvedValue(axiosOk({ data: [{ id: 's1', createdAt: '', sharedWith: SALMA }] }) as never);
    vi.mocked(rfpsApi.setVerifiers).mockResolvedValue(axiosOk({ data: [] }) as never);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add verifiers' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verifiers' });
    await within(dialog).findByText('Salma Bennani');
    // Carbon's checkbox input is visually hidden; its label is what is clicked.
    await user.click(within(dialog).getByText('Salma Bennani'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(rfpsApi.setVerifiers).toHaveBeenCalledWith('r1', ['u2']));
  });

  it("does not offer the choice to someone the tender was shared with", async () => {
    serve(makeRfp(piece(), [verifier(SALMA)], { userId: 'someone-else' }));
    renderPage();

    await screen.findByText('Salma Bennani');
    expect(screen.queryByRole('button', { name: /Manage|Add verifiers/ })).toBeNull();
  });
});
