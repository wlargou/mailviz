import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { RfpFormPanel, toDeadlineIso } from './RfpFormPanel';
import { rfpsApi } from '../../api/rfps';
import type { Rfp } from '../../types/rfp';

// The company picker fetches on mount; unmocked it breaks the render.
vi.mock('../../api/customers', () => ({
  customersApi: {
    getAll: vi.fn().mockResolvedValue({ data: { data: [{ id: 'c1', name: 'Bank Al-Maghrib' }] } }),
    getById: vi.fn().mockResolvedValue({ data: { data: { id: 'c1', name: 'Bank Al-Maghrib' } } }),
  },
}));

vi.mock('../../api/rfps', () => ({
  rfpsApi: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    uploadDocument: vi.fn(),
    deleteDocument: vi.fn(),
    getCatalogue: vi.fn(),
    documentUrl: (r: string, d: string) => `/api/v1/rfps/${r}/documents/${d}`,
  },
}));

/** The server's catalogue, trimmed to what the composition step shows. */
const CATALOGUE = [
  { kind: 'ADMINISTRATIF', label: 'Dossier administratif', perLot: false, defaultItems: ['Attestation fiscale', 'Attestation CNSS'] },
  { kind: 'TECHNIQUE', label: 'Dossier technique', perLot: false, defaultItems: ['Attestations de références'] },
  { kind: 'ADDITIF', label: 'Dossier additif', perLot: false, defaultItems: ['RC paraphé et signé'] },
  { kind: 'OFFRE_TECHNIQUE', label: 'Offre technique', perLot: true, defaultItems: ['CV des intervenants', 'Diplômes'] },
  { kind: 'OFFRE_FINANCIERE', label: 'Offre financière', perLot: true, defaultItems: ["Acte d'engagement"] },
  { kind: 'OTHER', label: 'Autre', perLot: false, defaultItems: [] },
];

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

function makeRfp(overrides: Partial<Rfp> = {}): Rfp {
  return {
    id: 'r1',
    name: 'Refonte AIX',
    reference: '70/AOO/BKAM/2026',
    customerId: null,
    customer: null,
    deadlineAt: new Date(2026, 11, 9, 10, 0, 0).toISOString(),
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

/**
 * Fill a field in one change event. Typing re-renders the whole five-step
 * wizard per keystroke — seconds per field — and these tests are about the
 * wizard, not the keyboard. The one test that is about keystrokes types.
 */
async function fill(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.clear(field);
  await user.click(field);
  await user.paste(text);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rfpsApi.getCatalogue).mockResolvedValue(axiosOk({ data: CATALOGUE }) as never);
});

/**
 * The deadline is a day AND an hour — "09/09/2026 à 10H" — and the hour is
 * when the sealed offers are opened. Combining the two inputs is the one bit
 * of arithmetic in this panel, so it is tested directly rather than through
 * the date picker.
 */
describe('toDeadlineIso', () => {
  it('puts the chosen wall-clock time on the chosen day', () => {
    const iso = toDeadlineIso(new Date(2026, 8, 9), '10:00');
    const back = new Date(iso!);
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(8);
    expect(back.getDate()).toBe(9);
    expect(back.getHours()).toBe(10);
    expect(back.getMinutes()).toBe(0);
    // Midnight from the picker must not survive as the deadline.
    expect(back.getHours()).not.toBe(0);
  });

  it('refuses a day without a time, and a time that is not one', () => {
    expect(toDeadlineIso(null, '10:00')).toBeNull();
    expect(toDeadlineIso(new Date(2026, 8, 9), '')).toBeNull();
    expect(toDeadlineIso(new Date(2026, 8, 9), '25:00')).toBeNull();
    expect(toDeadlineIso(new Date(2026, 8, 9), '10:60')).toBeNull();
    expect(toDeadlineIso(new Date(2026, 8, 9), '1000')).toBeNull();
  });
});

describe('RfpFormPanel', () => {
  it('seeds every field from the tender being edited, deadline hour included', () => {
    render(<RfpFormPanel open rfp={makeRfp()} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByLabelText('RFP name')).toHaveValue('Refonte AIX');
    expect(screen.getByLabelText('Reference')).toHaveValue('70/AOO/BKAM/2026');
    expect(screen.getByLabelText('Time')).toHaveValue('10:00');
    expect(screen.getByLabelText('Portal')).toHaveValue('https://portailachats.bankalmaghrib.ma/');
    expect(screen.getByRole('switch', { name: /Government-Owned Entity/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('edits what the tender is, and leaves its lots and budget to the page', async () => {
    // The budget is the lots' total now — a field for it here would be a
    // second, contradictory place to set it.
    vi.mocked(rfpsApi.update).mockResolvedValue(axiosOk({ data: makeRfp() }) as never);
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={makeRfp()} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.queryByLabelText(/budget/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(rfpsApi.update).toHaveBeenCalled());
    const body = vi.mocked(rfpsApi.update).mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('budget');
    expect(body).not.toHaveProperty('lots');
    expect(body).not.toHaveProperty('composition');
  });

  it('offers the portal only for a portal submission', async () => {
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={makeRfp()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole('combobox', { name: /Submission format/i }));
    await user.click(await screen.findByRole('option', { name: 'Paper' }));
    expect(screen.queryByLabelText('Portal')).toBeNull();
  });

  it('clears the portal link when the submission stops being a portal', async () => {
    vi.mocked(rfpsApi.update).mockResolvedValue(axiosOk({ data: makeRfp() }) as never);
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={makeRfp()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole('combobox', { name: /Submission format/i }));
    await user.click(await screen.findByRole('option', { name: 'Email' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(rfpsApi.update).toHaveBeenCalled());
    const body = vi.mocked(rfpsApi.update).mock.calls[0][1];
    expect(body.submissionFormat).toBe('EMAIL');
    // A stale portal link under a non-portal format is a link to nowhere.
    expect(body.portalUrl).toBeNull();
  });

  it('carries the company through a save', async () => {
    // A plain foreign key the server checks ownership on — losing it here
    // would silently unlink every tender from its buyer on the next edit.
    vi.mocked(rfpsApi.update).mockResolvedValue(axiosOk({ data: makeRfp() }) as never);
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={makeRfp({ customerId: 'c1', customer: { id: 'c1', name: 'Bank Al-Maghrib', logoUrl: null } })} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(rfpsApi.update).toHaveBeenCalled());
    expect(vi.mocked(rfpsApi.update).mock.calls[0][1]).toMatchObject({ customerId: 'c1' });
  });

  it('puts a duplicate reference on the field rather than in a toast', async () => {
    // The reference is the buyer's own numbering, so a 409 nearly always means
    // this tender is already in the register — the user needs to see it on the
    // field they must change, not in a corner.
    const conflict = new AxiosError('conflict', 'ERR', undefined, undefined, {
      status: 409, data: { error: { code: 'RFP_REFERENCE_TAKEN' } }, statusText: 'Conflict', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() },
    } as AxiosResponse);
    vi.mocked(rfpsApi.update).mockRejectedValue(conflict);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={makeRfp()} onClose={onClose} onSaved={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('An RFP with this reference already exists')).toBeInTheDocument();
    expect(screen.getByLabelText('Reference')).toHaveAttribute('data-invalid');
    // The panel stays open on the field that needs fixing.
    expect(onClose).not.toHaveBeenCalled();
  });

  /**
   * Carbon drives the date field with flatpickr; this sets the day on it.
   *
   * Retried inside the wait, re-reading the instance each time. Carbon's
   * DatePicker can rebuild its flatpickr on a re-render, and a `setDate` on
   * the instance being replaced fires into nothing — a race a loaded CI
   * runner lost once (#48) while every local run won it. `setDate` is
   * idempotent, so repeating it until Next unlocks is safe.
   *
   * Waiting on the input's own value would not do either: flatpickr writes
   * that synchronously, before the React state that gates Next has landed.
   */
  async function setDeadline(day: Date, idPrefix = 'rfp-new') {
    const next = () => screen.getByRole('button', { name: 'Next' });
    // A plain loop, not `setDate` inside `waitFor`'s callback: that callback
    // also runs on every DOM mutation, `setDate` mutates the DOM, and the two
    // feed each other as microtasks until the timeout can never fire.
    for (let attempt = 0; attempt < 5 && next().hasAttribute('disabled'); attempt++) {
      const input = document.querySelector(`#${idPrefix}-deadline-date`) as HTMLInputElement & {
        _flatpickr?: { setDate: (d: Date, fireChange: boolean) => void };
      };
      input._flatpickr!.setDate(day, true);
      try {
        await waitFor(() => expect(next()).toBeEnabled());
      } catch {
        /* the instance may have been replaced mid-call; set it again */
      }
    }
    expect(next()).toBeEnabled();
  }

  /**
   * Walk the create wizard to its last step.
   *
   * The steps are the point: nothing downstream is meaningful without a name
   * and a reference, and a tender with no deadline cannot be acted on, so
   * each of the first two steps refuses to advance without them.
   */
  async function walkToLots(user: ReturnType<typeof userEvent.setup>) {
    await fill(user, screen.getByLabelText('RFP name'), 'Maintenance SIMPL');
    await fill(user, screen.getByLabelText('Reference'), '27/2026/DGI');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentStep()).toBe('Deadline & submission'));

    await setDeadline(new Date(2026, 8, 9));
    await fill(user, screen.getByLabelText('Time'), '10:00');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentStep()).toBe('Lots & budget'));
  }

  /** From the lots step on: composition, then documents. */
  async function walkOnToDocuments(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentStep()).toBe('Composition'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentStep()).toBe('Documents'));
    return screen.getByRole('button', { name: 'Create RFP' });
  }

  async function walkToDocuments(user: ReturnType<typeof userEvent.setup>) {
    await walkToLots(user);
    return walkOnToDocuments(user);
  }

  /**
   * Which step is showing.
   *
   * Every step stays mounted — the wizard hides the inactive ones rather than
   * unmounting them — so the presence of a field says nothing about where you
   * are. The progress indicator does: it marks one step "Current".
   */
  const currentStep = () =>
    screen.getAllByRole('button').find((b) => b.textContent?.endsWith('Current'))?.textContent?.replace('Current', '');

  it('will not leave the first step without a name and a reference', async () => {
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    // Step one is where a duplicate reference is caught, so there is nothing
    // to gain from carrying an empty one forward.
    expect(currentStep()).toBe('Tender');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(currentStep()).toBe('Tender');

    await fill(user, screen.getByLabelText('RFP name'), 'Maintenance SIMPL');
    await fill(user, screen.getByLabelText('Reference'), '27/2026/DGI');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(currentStep()).toBe('Deadline & submission'));
  });

  it('fills questions closing seven days before the first deadline picked, and keeps what the user sets', async () => {
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await fill(user, screen.getByLabelText('RFP name'), 'Maintenance SIMPL');
    await fill(user, screen.getByLabelText('Reference'), '27/2026/DGI');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentStep()).toBe('Deadline & submission'));

    await setDeadline(new Date(2026, 8, 30));
    expect(screen.getByLabelText('Questions close')).toHaveValue('09/23/2026');

    // A second deadline does not move a questions date that is already set.
    // Moved before it, so the kept date is flagged — which also proves the
    // change reached state (flatpickr writes the input either way).
    const input = document.querySelector('#rfp-new-deadline-date') as HTMLInputElement & { _flatpickr: { setDate: (d: Date, f: boolean) => void } };
    input._flatpickr.setDate(new Date(2026, 8, 20), true);
    await waitFor(() => expect(screen.getByText('Must be before the deadline')).toBeInTheDocument());
    expect(screen.getByLabelText('Questions close')).toHaveValue('09/23/2026');
  });

  it('will not go on with questions closing after the deadline', async () => {
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await fill(user, screen.getByLabelText('RFP name'), 'Maintenance SIMPL');
    await fill(user, screen.getByLabelText('Reference'), '27/2026/DGI');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentStep()).toBe('Deadline & submission'));
    await setDeadline(new Date(2026, 8, 30));

    const q = document.querySelector('#rfp-new-questions-date') as HTMLInputElement & { _flatpickr: { setDate: (d: Date, f: boolean) => void } };
    q._flatpickr.setDate(new Date(2026, 9, 2), true);

    await waitFor(() => expect(screen.getByText('Must be before the deadline')).toBeInTheDocument());
    // Carbon applies `disableSubmit` from an effect, a render after the field.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled());
  });

  it('will not leave the deadline step without one', async () => {
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await fill(user, screen.getByLabelText('RFP name'), 'Maintenance SIMPL');
    await fill(user, screen.getByLabelText('Reference'), '27/2026/DGI');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentStep()).toBe('Deadline & submission'));

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(currentStep()).toBe('Deadline & submission');

    await setDeadline(new Date(2026, 8, 9));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentStep()).toBe('Lots & budget'));
  });

  it('creates a tender with the day and the hour combined into one instant', async () => {
    vi.mocked(rfpsApi.create).mockResolvedValue(axiosOk({ data: makeRfp({ id: 'new-1' }) }) as never);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={onClose} onSaved={vi.fn()} />);

    const submit = await walkToDocuments(user);
    await user.click(submit);

    await waitFor(() => expect(rfpsApi.create).toHaveBeenCalled());
    const body = vi.mocked(rfpsApi.create).mock.calls[0][0];
    const sent = new Date(body.deadlineAt);
    expect(sent.getFullYear()).toBe(2026);
    expect(sent.getMonth()).toBe(8);
    expect(sent.getDate()).toBe(9);
    expect(sent.getHours()).toBe(10);
    expect(body).toMatchObject({ name: 'Maintenance SIMPL', reference: '27/2026/DGI', customerId: null });
    expect(onClose).toHaveBeenCalled();
  });

  it('starts as one "Lot unique", and asks for budgets only for a public buyer', async () => {
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await walkToLots(user);

    expect(screen.getByLabelText('Lot 1 title')).toHaveValue('Lot unique');
    expect(screen.queryByLabelText('Lot 1 budget (MAD)')).toBeNull();

    await user.click(screen.getByRole('switch', { name: /Government-Owned Entity/i }));
    expect(screen.getByLabelText('Lot 1 budget (MAD)')).toBeInTheDocument();
  });

  it('sends each lot with its own budget, and "Lot unique" stops being unique', async () => {
    vi.mocked(rfpsApi.create).mockResolvedValue(axiosOk({ data: makeRfp({ id: 'new-1' }) }) as never);
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await walkToLots(user);

    await user.click(screen.getByRole('switch', { name: /Government-Owned Entity/i }));
    await user.click(screen.getByRole('button', { name: 'Add lot' }));
    // A second lot makes the first one "Lot 1", not a lot unique among two.
    expect(screen.getByLabelText('Lot 1 title')).toHaveValue('Lot 1');
    await fill(user, screen.getByLabelText('Lot 2 title'), 'Support');
    await fill(user, screen.getByLabelText('Lot 1 budget (MAD)'), '1500000');
    await fill(user, screen.getByLabelText('Lot 2 budget (MAD)'), '400000');

    await user.click(await walkOnToDocuments(user));

    await waitFor(() => expect(rfpsApi.create).toHaveBeenCalled());
    expect(vi.mocked(rfpsApi.create).mock.calls[0][0].lots).toEqual([
      { title: 'Lot 1', budget: 1500000 },
      { title: 'Support', budget: 400000 },
    ]);
  });

  it('reads a budget typed the way the Avis prints it, and refuses one that is not an amount', async () => {
    vi.mocked(rfpsApi.create).mockResolvedValue(axiosOk({ data: makeRfp({ id: 'new-1' }) }) as never);
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await walkToLots(user);
    await user.click(screen.getByRole('switch', { name: /Government-Owned Entity/i }));

    await user.type(screen.getByLabelText('Lot 1 budget (MAD)'), '1 500 000,x');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(currentStep()).toBe('Lots & budget');

    // Typed key by key: the comma must survive until the cents follow it.
    await user.type(screen.getByLabelText('Lot 1 budget (MAD)'), '{Backspace}00');
    expect(screen.getByText(/Total 1 500 000 DH/)).toBeInTheDocument();
    await user.click(await walkOnToDocuments(user));

    await waitFor(() => expect(rfpsApi.create).toHaveBeenCalled());
    expect(vi.mocked(rfpsApi.create).mock.calls[0][0].lots).toEqual([{ title: 'Lot unique', budget: 1500000 }]);
  });

  it('sends no budget for a private buyer, even if one had been typed', async () => {
    vi.mocked(rfpsApi.create).mockResolvedValue(axiosOk({ data: makeRfp({ id: 'new-1' }) }) as never);
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await walkToLots(user);

    await user.click(screen.getByRole('switch', { name: /Government-Owned Entity/i }));
    await fill(user, screen.getByLabelText('Lot 1 budget (MAD)'), '1500000');
    await user.click(screen.getByRole('switch', { name: /Government-Owned Entity/i }));

    await user.click(await walkOnToDocuments(user));

    await waitFor(() => expect(rfpsApi.create).toHaveBeenCalled());
    const body = vi.mocked(rfpsApi.create).mock.calls[0][0];
    expect(body.isGoe).toBe(false);
    expect(body.lots).toEqual([{ title: 'Lot unique', budget: null }]);
  });

  it('will not leave the lots step with an untitled lot, and never removes the last one', async () => {
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await walkToLots(user);

    expect(screen.getByRole('button', { name: 'Remove lot 1' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Lot 1 title'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(currentStep()).toBe('Lots & budget');

    await fill(user, screen.getByLabelText('Lot 1 title'), 'Lot unique');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentStep()).toBe('Composition'));
  });

  it('sends the chosen dossiers, the four usual ones by default', async () => {
    vi.mocked(rfpsApi.create).mockResolvedValue(axiosOk({ data: makeRfp({ id: 'new-1' }) }) as never);
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await walkToLots(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentStep()).toBe('Composition'));

    // What each dossier starts with is shown before it is chosen.
    expect(screen.getByText('CV des intervenants · Diplômes')).toBeInTheDocument();
    // "Autre" is added from the page, for what the RC invents.
    expect(screen.queryByLabelText('Autre')).toBeNull();
    expect(screen.getByLabelText('Dossier additif')).not.toBeChecked();

    // Carbon's checkbox input is visually hidden; its label is what is clicked.
    await user.click(screen.getByText('Dossier additif'));
    await user.click(screen.getByText('Dossier technique'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentStep()).toBe('Documents'));
    await user.click(screen.getByRole('button', { name: 'Create RFP' }));

    await waitFor(() => expect(rfpsApi.create).toHaveBeenCalled());
    expect(vi.mocked(rfpsApi.create).mock.calls[0][0].composition).toEqual({
      kinds: ['ADMINISTRATIF', 'OFFRE_TECHNIQUE', 'OFFRE_FINANCIERE', 'ADDITIF'],
      prefill: true,
    });
  });

  it('says the offers are made once per lot', async () => {
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await walkToLots(user);
    await user.click(screen.getByRole('button', { name: 'Add lot' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentStep()).toBe('Composition'));

    expect(screen.getByLabelText('Offre technique — one per lot (2)')).toBeInTheDocument();
    // A tender-wide dossier is prepared once, however many lots there are.
    expect(screen.getByLabelText('Dossier administratif')).toBeInTheDocument();
  });

  it('opens the new tender once it exists', async () => {
    vi.mocked(rfpsApi.create).mockResolvedValue(axiosOk({ data: makeRfp({ id: 'new-1' }) }) as never);
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={vi.fn()} onSaved={vi.fn()} onCreated={onCreated} />);

    await user.click(await walkToDocuments(user));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-1'));
  });

  it('keeps the tender when only a document fails, rather than reporting a failed save', async () => {
    // The create succeeded; the upload did not. Reporting that as "Failed to
    // create the RFP" and holding the panel open told the user nothing had
    // happened while the row was already in the table — which is exactly what
    // the first browser run did, because the shared axios client had forced a
    // JSON content type onto the multipart body.
    vi.mocked(rfpsApi.create).mockResolvedValue(axiosOk({ data: makeRfp({ id: 'new-1' }) }) as never);
    vi.mocked(rfpsApi.uploadDocument).mockRejectedValue(new Error('network'));
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={onClose} onSaved={onSaved} />);

    const submit = await walkToDocuments(user);
    await user.upload(screen.getByLabelText('Add file'), new File(['%PDF'], 'RC.pdf', { type: 'application/pdf' }));
    await user.click(submit);

    await waitFor(() => expect(rfpsApi.uploadDocument).toHaveBeenCalled());
    // The tender exists, so the panel closes and the table is told to refresh.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
    expect(rfpsApi.create).toHaveBeenCalledTimes(1);
  });

  it('holds files chosen on the last step until the tender exists', async () => {
    const user = userEvent.setup();
    render(<RfpFormPanel open rfp={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await walkToDocuments(user);
    await user.upload(screen.getByLabelText('Add file'), new File(['%PDF'], 'CPS AO 70.pdf', { type: 'application/pdf' }));

    // Nothing to attach to yet, so nothing is sent.
    expect(rfpsApi.uploadDocument).not.toHaveBeenCalled();
    expect(screen.getByText('CPS AO 70.pdf')).toBeInTheDocument();
    expect(screen.getByText('Uploads when saved')).toBeInTheDocument();
  });
});
