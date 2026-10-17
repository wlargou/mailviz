import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReferenceDetailPage } from './ReferenceDetailPage';
import { clientReferencesApi } from '../../api/clientReferences';
import { useUIStore } from '../../store/uiStore';
import { makeReference } from './testFixtures';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('../../api/clientReferences', () => ({
  clientReferencesApi: {
    getById: vi.fn(),
    getIds: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    uploadDocument: vi.fn(),
    documentUrl: (id: string) => `/api/v1/client-references/${id}/document`,
    documentInlineUrl: (id: string, v?: string | null) => `/api/v1/client-references/${id}/document?inline=true&v=${v}`,
  },
}));

// The company picker searches the API on mount; it is not what is under test.
vi.mock('../shared/CompanyComboBox', () => ({
  CompanyComboBox: () => <div data-testid="company-picker" />,
}));

const api = vi.mocked(clientReferencesApi);
const ok = <T,>(data: T) => ({ data: { data } }) as never;
const STATE = { query: { tags: 'IBM Power' }, back: '/deals?tab=references&tags=IBM+Power' };

function renderAt(id: string, state: unknown = STATE) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/references/${id}`, state }]}>
      <Routes>
        <Route path="/references/:id" element={<ReferenceDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) if (typeof fn === 'function' && 'mockReset' in fn) (fn as ReturnType<typeof vi.fn>).mockReset();
  api.getById.mockResolvedValue(ok(makeReference()));
  api.getIds.mockResolvedValue(ok(['ref0', 'ref1', 'ref2']));
  navigateSpy.mockReset();
  useUIStore.setState({ notifications: [] } as never);
});

/** A form field by its label — the sections are labelled by their headings too, so by role. */
const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;

/**
 * An icon button by its tooltip. With `autoAlign`, jsdom computes the name as
 * "" (floating-ui keeps the tooltip hidden), so read it as a browser does —
 * see `labelled()` in ThreadDetail.test.tsx.
 */
function button(name: string): HTMLElement {
  const found = screen.queryAllByRole('button').find((b) => {
    const id = b.getAttribute('aria-labelledby');
    return (id ? document.getElementById(id)?.textContent : b.getAttribute('aria-label') ?? b.textContent)?.trim() === name;
  });
  if (!found) throw new Error(`No button "${name}"`);
  return found;
}

describe('ReferenceDetailPage', () => {
  it('shows the fields beside the document, and where it sits in the list', async () => {
    renderAt('ref1');
    expect(await screen.findByDisplayValue('CMI — Centre Monétique Interbancaire')).toBeInTheDocument();
    expect(field('Amount').value).toBe('16 090 620');
    expect(field('Project start').value).toBe('2022');
    expect(field('Signed on').value).toBe('19/12/2023');
    expect(screen.getByTitle('Document preview')).toHaveAttribute('src', '/api/v1/client-references/ref1/document?inline=true&v=2026-10-17T00:00:00.000Z');
    expect(await screen.findByText('2 of 3')).toBeInTheDocument();
    expect(api.getIds).toHaveBeenCalledWith({ tags: 'IBM Power' });
    // Nothing to save until something changes.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves only the field that changed', async () => {
    const user = userEvent.setup();
    api.update.mockResolvedValue(ok(makeReference({ city: 'Rabat' })));
    renderAt('ref1');
    await screen.findByDisplayValue('CMI — Centre Monétique Interbancaire');
    const city = field('City');
    await user.clear(city);
    await user.type(city, 'Rabat');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.update).toHaveBeenCalledWith('ref1', { city: 'Rabat' }));
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it('saves the corrections before stepping to the next reference', async () => {
    const user = userEvent.setup();
    api.update.mockResolvedValue(ok(makeReference({ projectEnd: '2023-06' })));
    renderAt('ref1');
    await screen.findByText('2 of 3');
    const end = field('Project end');
    await user.clear(end);
    await user.type(end, '06/2023');
    await user.click(button('Save and open the next'));

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/references/ref2', { state: STATE }));
    expect(api.update).toHaveBeenCalledWith('ref1', { projectEnd: '2023-06' });
    expect(api.update.mock.invocationCallOrder[0]).toBeLessThan(navigateSpy.mock.invocationCallOrder[0]);
  });

  it('steps without saving when nothing changed, and stays when a save fails', async () => {
    const user = userEvent.setup();
    renderAt('ref1');
    await screen.findByText('2 of 3');
    await user.click(button('Previous reference'));
    expect(navigateSpy).toHaveBeenCalledWith('/references/ref0', { state: STATE });
    expect(api.update).not.toHaveBeenCalled();

    navigateSpy.mockReset();
    api.update.mockRejectedValue(new Error('down'));
    await user.type(field('City'), ' Centre');
    await user.click(button('Save and open the next'));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('refuses to save a field that does not read, and says which', async () => {
    const user = userEvent.setup();
    renderAt('ref1');
    await screen.findByDisplayValue('CMI — Centre Monétique Interbancaire');
    const amount = field('Amount');
    await user.clear(amount);
    await user.type(amount, '12 abc');
    expect(await screen.findByText('Not an amount — e.g. 1 500 000,00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.update).not.toHaveBeenCalled();
    expect(useUIStore.getState().notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Some fields need correcting', subtitle: 'Not an amount — e.g. 1 500 000,00' })]),
    );
  });

  it('does not step away from a field that does not read', async () => {
    const user = userEvent.setup();
    renderAt('ref1');
    await screen.findByText('2 of 3');
    const amount = field('Amount');
    await user.clear(amount);
    await user.type(amount, '12 abc');
    await user.click(button('Save and open the next'));
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('saves once however often ⌘S is pressed while the save is out', async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    api.update.mockReturnValue(new Promise((r) => (resolve = r)) as never);
    renderAt('ref1');
    await screen.findByDisplayValue('CMI — Centre Monétique Interbancaire');
    await user.type(field('City'), ' Centre');
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    resolve(ok(makeReference({ city: 'Casablanca Centre' })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it('keeps what was typed while the save was out — REGRESSION', async () => {
    // The response replaced the whole form, erasing the newer edit.
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    api.update.mockReturnValue(new Promise((r) => (resolve = r)) as never);
    renderAt('ref1');
    await screen.findByDisplayValue('CMI — Centre Monétique Interbancaire');
    await user.clear(field('City'));
    await user.type(field('City'), 'Rabat');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.type(field('Attestation n°'), 'N°12');
    resolve(ok(makeReference({ city: 'Rabat' })));

    await waitFor(() => expect(field('City').value).toBe('Rabat'));
    expect(field('Attestation n°').value).toBe('N°12');
    // Still unsaved, so Save is offered again.
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('asks before leaving with unsaved corrections', async () => {
    const user = userEvent.setup();
    renderAt('ref1');
    await screen.findByDisplayValue('CMI — Centre Monétique Interbancaire');
    await user.type(field('City'), ' Centre');

    await user.click(screen.getByRole('link', { name: 'References' }));
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(field('City').value).toBe('Casablanca Centre');

    await user.click(screen.getByRole('link', { name: 'References' }));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(navigateSpy).toHaveBeenCalledWith(STATE.back);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('leaves at once when nothing changed', async () => {
    const user = userEvent.setup();
    renderAt('ref1');
    await screen.findByDisplayValue('CMI — Centre Monétique Interbancaire');
    await user.click(screen.getByRole('link', { name: 'References' }));
    expect(navigateSpy).toHaveBeenCalledWith(STATE.back);
  });

  it('replaces the document with a PDF, and refuses anything else', async () => {
    api.uploadDocument.mockResolvedValue(ok(makeReference({ documentFilename: 'rescan.pdf', documentUploadedAt: '2026-10-18T00:00:00.000Z' })));
    renderAt('ref1');
    await screen.findByDisplayValue('CMI — Centre Monétique Interbancaire');
    const input = screen.getByTestId('reference-file-input');

    fireEvent.change(input, { target: { files: [new File(['x'], 'letter.docx', { type: 'application/msword' })] } });
    expect(api.uploadDocument).not.toHaveBeenCalled();

    const pdf = new File(['%PDF'], 'rescan.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [pdf] } });
    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledWith('ref1', pdf));
    await waitFor(() => expect(screen.getByTitle('Document preview').getAttribute('src')).toContain('v=2026-10-18'));
    expect(screen.getByText('rescan.pdf')).toBeInTheDocument();
  });

  it('a new reference is created first, then its document uploaded', async () => {
    const user = userEvent.setup();
    // No URL, so no frame: any frame jsdom makes for it has an opaque origin,
    // and user-event then trips over its localStorage.
    URL.createObjectURL = vi.fn(() => '');
    URL.revokeObjectURL = vi.fn();
    api.create.mockResolvedValue(ok(makeReference({ id: 'new1', hasDocument: false })));
    api.uploadDocument.mockResolvedValue(ok(makeReference({ id: 'new1' })));
    renderAt('new', { back: '/deals?tab=references' });

    await user.type(await screen.findByRole('textbox', { name: 'Customer, as the letter names it' }), 'Bank Al-Maghrib');
    await user.type(field('Amount'), '20 266 396,40');
    const pdf = new File(['%PDF'], 'bam.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('reference-file-input'), { target: { files: [pdf] } });
    expect(await screen.findByText('bam.pdf')).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledWith(pdf);

    await user.click(screen.getByRole('button', { name: 'Add reference' }));
    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledWith('new1', pdf));
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ customerName: 'Bank Al-Maghrib', amount: 20266396.4, amountType: null }));
    expect(navigateSpy).toHaveBeenCalledWith('/references/new1', { replace: true, state: { back: '/deals?tab=references' } });
  });

  it('does not call an empty new form wrong until a save is tried', async () => {
    const user = userEvent.setup();
    renderAt('new', { back: '/deals?tab=references' });
    await screen.findByRole('textbox', { name: 'Customer, as the letter names it' });
    expect(screen.queryByText('The customer is required')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add reference' }));
    expect(await screen.findByText('The customer is required')).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('says so when the reference is gone', async () => {
    api.getById.mockRejectedValue(Object.assign(new Error('nf'), { isAxiosError: true, response: { status: 404 } }));
    renderAt('ref9');
    expect(await screen.findByText('Reference not found')).toBeInTheDocument();
  });
});
