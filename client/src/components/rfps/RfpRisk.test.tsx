import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { RfpDetailPage } from './RfpDetailPage';
import { rfpsApi } from '../../api/rfps';
import { useAuthStore } from '../../store/authStore';
import type { RfpDetail, RfpItem, RfpPerson } from '../../types/rfp';

vi.mock('../../api/rfps', () => ({
  rfpsApi: {
    getById: vi.fn(), getCatalogue: vi.fn(), getPeople: vi.fn(), updateItem: vi.fn(), delete: vi.fn(),
    getRfpShares: vi.fn(), uploadItemDocument: vi.fn(), deleteDocument: vi.fn(), decide: vi.fn(), withdrawDecision: vi.fn(),
    documentUrl: (r: string, d: string) => `/api/v1/rfps/${r}/documents/${d}`,
    documentInlineUrl: (r: string, d: string) => `/api/v1/rfps/${r}/documents/${d}?inline=true`,
  },
}));
vi.mock('./RfpFormPanel', () => ({ RfpFormPanel: () => null }));
vi.mock('../shared/AttachmentPreviewModal', () => ({ AttachmentPreviewModal: () => null }));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

const DAY = 86_400_000;
const ME: RfpPerson = { id: 'me', name: 'Walid', email: 'walid@powerm.ma', avatarUrl: null };
const SALMA: RfpPerson = { id: 'u2', name: 'Salma Bennani', email: 'salma@powerm.ma', avatarUrl: null };

function item(id: string, title: string, over: Partial<RfpItem> = {}): RfpItem {
  return { id, folderId: 'f1', title, status: 'TODO', notes: null, position: 0, updatedAt: '', documents: [], verifications: [], ...over };
}

function makeRfp(over: Partial<RfpDetail> = {}): RfpDetail {
  return {
    id: 'r1', name: 'Refonte AIX', reference: '70/AOO/BKAM/2026', customerId: null, customer: null,
    // Registered 8 days ago, due in 2: 80% of the time used.
    createdAt: new Date(Date.now() - 8 * DAY).toISOString(),
    deadlineAt: new Date(Date.now() + 2 * DAY).toISOString(),
    questionsDeadlineAt: null, publishedAt: null,
    submissionFormat: 'PORTAL', portalUrl: null, isGoe: true, budget: 31666500, status: 'WORKING', notes: null,
    userId: 'me', user: { id: 'me', name: 'Walid', email: 'walid@powerm.ma' }, updatedAt: '', documents: [],
    lots: [{ id: 'l1', rfpId: 'r1', number: 1, title: 'Lot unique', budget: 31666500 }],
    verifiers: [], _count: { shares: 1 },
    folders: [
      { id: 'f1', rfpId: 'r1', lotId: null, lot: null, kind: 'ADMINISTRATIF', title: 'Dossier administratif', position: 0,
        items: [
          item('i1', 'Attestation fiscale', { status: 'READY', assigneeId: 'me', assignee: ME }),
          item('i2', 'Attestation CNSS', { assigneeId: 'u2', assignee: SALMA, dueDate: new Date(Date.now() - DAY).toISOString() }),
          item('i3', 'Caution provisoire'),
        ] },
      { id: 'f2', rfpId: 'r1', lotId: null, lot: null, kind: 'TECHNIQUE', title: 'Dossier technique', position: 1,
        items: [item('i4', 'Références')] },
    ],
    ...over,
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

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'me', email: 'walid@powerm.ma', name: 'Walid', avatarUrl: null } });
  vi.mocked(rfpsApi.getCatalogue).mockResolvedValue(axiosOk({ data: [] }) as never);
  vi.mocked(rfpsApi.getPeople).mockResolvedValue(axiosOk({ data: [ME, SALMA] }) as never);
  vi.mocked(rfpsApi.updateItem).mockResolvedValue(axiosOk({ data: {} }) as never);
});

describe('RFP page — risk', () => {
  it('flags a tender whose readiness trails the time used, and shows both', async () => {
    serve(makeRfp());
    renderPage();

    expect(await screen.findByText('▲ At risk')).toBeInTheDocument();
    // 1 of 4 ready, 80% of the time gone.
    expect(screen.getByLabelText('25% ready, 80% of the time used')).toBeInTheDocument();
    expect(screen.getByText('1 of 4 pieces ready')).toBeInTheDocument();
  });

  it('does not flag a tender on pace', async () => {
    serve(makeRfp({ createdAt: new Date(Date.now() - 1 * DAY).toISOString(), deadlineAt: new Date(Date.now() + 30 * DAY).toISOString() }));
    renderPage();

    await screen.findByRole('heading', { name: 'Refonte AIX' });
    expect(screen.queryByText('▲ At risk')).toBeNull();
  });

  it('says when questions close, and how far that is', async () => {
    serve(makeRfp({ questionsDeadlineAt: new Date(Date.now() + DAY + 3_600_000).toISOString() }));
    renderPage();

    expect(await screen.findByText(/^Questions close .* · tomorrow$/)).toBeInTheDocument();
  });

  it('keeps Delete in a menu behind Edit and Share', async () => {
    serve(makeRfp());
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'Refonte AIX' });
    expect(screen.queryByRole('button', { name: 'Delete RFP' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const items = await screen.findAllByRole('menuitem', { hidden: true });
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Delete RFP']);
  });
});

describe('RFP page — who prepares what', () => {
  it('shows each dossier at a glance: owners, unassigned pieces, readiness, next due', async () => {
    serve(makeRfp());
    renderPage();

    const table = await screen.findByRole('table', { name: 'Dossiers at a glance' });
    const [, admin, tech] = within(table).getAllByRole('row');
    expect(within(admin).getByText('Dossier administratif')).toBeInTheDocument();
    expect(within(admin).getByText('1 unassigned')).toBeInTheDocument();
    expect(within(admin).getByLabelText('1 of 3 pieces ready')).toBeInTheDocument();
    // The CNSS piece was due yesterday.
    expect(within(admin).getByText(/day ago|late/)).toHaveClass('rfp-response__due--late');
    expect(within(tech).getByText('1 unassigned')).toBeInTheDocument();
  });

  it('opens a dossier from its overview row', async () => {
    serve(makeRfp());
    const user = userEvent.setup();
    renderPage();

    const table = await screen.findByRole('table', { name: 'Dossiers at a glance' });
    // The accordion's own heading — the overview row has the same words.
    const heading = () => document.getElementById('rfp-folder-f1')!.closest('button')!;
    expect(heading()).toHaveAttribute('aria-expanded', 'false');
    await user.click(within(table).getByText('Dossier administratif'));

    await waitFor(() => expect(heading()).toHaveAttribute('aria-expanded', 'true'));
    expect(document.getElementById('rfp-folder-f2')!.closest('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it("shows a piece's owner and due date on its row", async () => {
    serve(makeRfp());
    const user = userEvent.setup();
    renderPage();

    await user.click(within(await screen.findByRole('table', { name: 'Dossiers at a glance' })).getByText('Dossier administratif'));
    const row = (await screen.findByRole('button', { name: 'Attestation CNSS' })).closest('li')!;
    expect(within(row).getByText('Salma Bennani')).toBeInTheDocument();
    expect(within(row).getByText(/due /)).toHaveClass('rfp-response__due--late');
  });

  it('assigns an owner, and gives an undated piece the internal freeze two days before the deadline', async () => {
    const deadline = new Date(Date.now() + 10 * DAY);
    serve(makeRfp({ deadlineAt: deadline.toISOString() }));
    const user = userEvent.setup();
    renderPage();

    await user.click(within(await screen.findByRole('table', { name: 'Dossiers at a glance' })).getByText('Dossier administratif'));
    await user.click(await screen.findByRole('button', { name: 'Caution provisoire' }));
    const panel = await screen.findByRole('complementary', { name: /Caution provisoire/ });
    await user.click(within(panel).getByRole('combobox', { name: /Owner/ }));
    await user.click(await within(panel).findByRole('option', { name: 'Salma Bennani' }));

    await waitFor(() => expect(rfpsApi.updateItem).toHaveBeenCalled());
    const body = vi.mocked(rfpsApi.updateItem).mock.calls[0][2] as { assigneeId: string; dueDate: string };
    expect(body.assigneeId).toBe('u2');
    const freeze = new Date(deadline.getTime() - 2 * DAY);
    expect(new Date(body.dueDate).toDateString()).toBe(freeze.toDateString());
    expect(new Date(body.dueDate).getHours()).toBe(18);
  });

  it('keeps a due date the piece already has when its owner changes', async () => {
    serve(makeRfp());
    const user = userEvent.setup();
    renderPage();

    await user.click(within(await screen.findByRole('table', { name: 'Dossiers at a glance' })).getByText('Dossier administratif'));
    await user.click(await screen.findByRole('button', { name: 'Attestation CNSS' }));
    const panel = await screen.findByRole('complementary', { name: /Attestation CNSS/ });
    await user.click(within(panel).getByRole('combobox', { name: /Owner/ }));
    await user.click(await within(panel).findByRole('option', { name: 'Walid' }));

    await waitFor(() => expect(rfpsApi.updateItem).toHaveBeenCalledWith('r1', 'i2', { assigneeId: 'me' }));
  });
});
