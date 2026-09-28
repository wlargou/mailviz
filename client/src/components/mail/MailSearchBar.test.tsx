import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MailSearchBar, searchScope, type MailFilters } from './MailSearchBar';
import { emailsApi } from '../../api/emails';

/**
 * "Clear all" clears the search, not the folder.
 *
 * The folder is not a filter — it is where the user is. Wiping it here sent you
 * back to the Inbox from Archive, Sent or Snoozed the moment you cleared a
 * search, which is exactly when you are looking at results rather than at the
 * folder list. The component's own filter count already excludes the folder,
 * so the two disagreed about what a filter was.
 */

vi.mock('../../api/emails', () => ({
  emailsApi: { suggest: vi.fn() },
}));

vi.mock('../shared/CompanyComboBox', () => ({
  CompanyComboBox: () => <div data-testid="company-combobox-stub" />,
}));

const BASE: MailFilters = {
  search: '',
  from: '',
  to: '',
  participant: '',
  participantName: '',
  subject: '',
  dateAfter: '',
  dateBefore: '',
  customerIds: [],
  isRead: null,
  hasAttachment: false,
  folder: null,
};

beforeEach(() => vi.clearAllMocks());

describe('MailSearchBar — Clear all', () => {
  it('keeps the folder you are reading', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(
      <MailSearchBar
        // `subject` is what puts the Clear all button on screen: the tag row
        // it lives in is driven by the advanced filters, and search and folder
        // are excluded from it by design.
        filters={{ ...BASE, folder: 'archive', search: 'invoice', subject: 'Q3' }}
        onFiltersChange={onFiltersChange}
      />
    );

    await user.click(await screen.findByRole('button', { name: /clear all/i }));

    await waitFor(() => expect(onFiltersChange).toHaveBeenCalled());
    const next = onFiltersChange.mock.calls[0][0];
    expect(next.folder).toBe('archive');
  });

  it('still clears everything that IS a filter', async () => {
    // The guard against over-correcting: preserving the folder must not turn
    // "Clear all" into "clear nothing".
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(
      <MailSearchBar
        filters={{
          ...BASE,
          folder: 'sent',
          search: 'invoice',
          subject: 'Q3',
          hasAttachment: true,
          isRead: 'false',
        }}
        onFiltersChange={onFiltersChange}
      />
    );

    await user.click(await screen.findByRole('button', { name: /clear all/i }));

    await waitFor(() => expect(onFiltersChange).toHaveBeenCalled());
    const next = onFiltersChange.mock.calls[0][0];
    expect(next).toMatchObject({
      folder: 'sent',
      search: '',
      subject: '',
      hasAttachment: false,
      isRead: null,
    });
  });

  it('leaves a null folder null rather than inventing one', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(
      <MailSearchBar
        filters={{ ...BASE, search: 'invoice', subject: 'Q3' }}
        onFiltersChange={onFiltersChange}
      />
    );

    await user.click(await screen.findByRole('button', { name: /clear all/i }));

    await waitFor(() => expect(onFiltersChange).toHaveBeenCalled());
    expect(onFiltersChange.mock.calls[0][0].folder).toBeNull();
  });
});

// ─── Suggestions ────────────────────────────────────────────────────────────

const HICHAM = { address: 'h.gadialami@awb.test', name: 'GADI-ALAMI HICHAM', messages: 40, lastAt: '2026-09-28T10:00:00Z', automated: false };
const AKRAM = { address: 'akramafkir@gmail.test', name: null, messages: 3, lastAt: '2026-09-20T10:00:00Z', automated: false };
const PEP = {
  threadId: 't-pep',
  emailId: 'e-pep',
  subject: 'RE: Projet Migration // Fichier PEP XML',
  from: 'h.gadialami@awb.test',
  fromName: 'GADI-ALAMI HICHAM',
  receivedAt: '2026-09-28T09:00:00Z',
};
const answer = (people: unknown[], threads: unknown[] = []) => ({ data: { data: { people, threads } } }) as never;
/**
 * Suggestions arrive after a 250ms debounce. Testing Library's own 1s wait is
 * plenty alone and tight under a full, loaded run — a longer ceiling only
 * changes how long a real failure takes to report.
 */
const WAIT = { timeout: 3000 };

function renderBar(filters: MailFilters = { ...BASE, folder: 'inbox' }) {
  const onFiltersChange = vi.fn();
  const onOpenThread = vi.fn();
  const { container } = render(
    <MailSearchBar filters={filters} onFiltersChange={onFiltersChange} onOpenThread={onOpenThread} />
  );
  return { container, onFiltersChange, onOpenThread, input: screen.getByRole('combobox', { name: 'Search mail' }) };
}

describe('MailSearchBar — suggestions', () => {
  beforeEach(() => vi.mocked(emailsApi.suggest).mockResolvedValue(answer([HICHAM, AKRAM], [PEP])));

  it('offers people and threads from the second character', async () => {
    const user = userEvent.setup();
    const { input } = renderBar();

    await user.type(input, 'h');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.type(input, 'i');

    const list = await screen.findByRole('listbox', { name: 'Search suggestions' }, WAIT);
    expect(await within(list).findByRole('option', { name: 'GADI-ALAMI HICHAM, h.gadialami@awb.test' }, WAIT)).toBeInTheDocument();
    // No name on their mail: the address stands in.
    expect(within(list).getByRole('option', { name: 'akramafkir@gmail.test' })).toBeInTheDocument();
    expect(within(list).getByRole('option', { name: /Fichier PEP XML/ })).toBeInTheDocument();
    expect(within(list).getByRole('option', { name: /Search mail for/ })).toBeInTheDocument();
    expect(emailsApi.suggest).toHaveBeenCalledTimes(1);
    expect(emailsApi.suggest).toHaveBeenCalledWith('hi');
  });

  it('picking a person filters to mail with them, in all mail when searched from the Inbox', async () => {
    const user = userEvent.setup();
    const { input, onFiltersChange } = renderBar();

    await user.type(input, 'hicham');
    await user.click(await screen.findByRole('option', { name: 'GADI-ALAMI HICHAM, h.gadialami@awb.test' }, WAIT));

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange.mock.calls[0][0]).toMatchObject({
      search: '',
      participant: 'h.gadialami@awb.test',
      participantName: 'GADI-ALAMI HICHAM',
      folder: null,
    });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('picking a thread opens it, and leaves the list as it was', async () => {
    const user = userEvent.setup();
    const { input, onFiltersChange, onOpenThread } = renderBar();

    await user.type(input, 'pep');
    await user.click(await screen.findByRole('option', { name: /Fichier PEP XML/ }, WAIT));

    expect(onOpenThread).toHaveBeenCalledWith('t-pep');
    expect(onFiltersChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('walks the list with the arrows, closes on Escape, and picks with Enter', async () => {
    const user = userEvent.setup();
    const { input, onFiltersChange } = renderBar();

    await user.type(input, 'hicham');
    await screen.findByRole('option', { name: 'GADI-ALAMI HICHAM, h.gadialami@awb.test' }, WAIT);
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'mail-suggest-search');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'mail-suggest-person-0');
    // Up from the top wraps to the last row.
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', 'mail-suggest-thread-0');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(onFiltersChange).not.toHaveBeenCalled();

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange.mock.calls[0][0]).toMatchObject({ participant: 'h.gadialami@awb.test', search: '' });
  });

  it('runs the search as typed on Enter, in all mail from the Inbox and in a folder chosen on purpose', async () => {
    const user = userEvent.setup();
    const inbox = renderBar();
    await user.type(inbox.input, 'hicham{Enter}');
    expect(inbox.onFiltersChange.mock.calls[0][0]).toMatchObject({ search: 'hicham', participant: '', folder: null });
  });

  it('keeps Sent as the scope of a search made there', async () => {
    const user = userEvent.setup();
    const sent = renderBar({ ...BASE, folder: 'sent' });
    await user.type(sent.input, 'hicham{Enter}');
    expect(sent.onFiltersChange.mock.calls[0][0]).toMatchObject({ search: 'hicham', folder: 'sent' });
  });

  it('never lets an answer to an earlier keystroke replace a later one', async () => {
    const user = userEvent.setup();
    const EARLIER = { ...AKRAM, address: 'earlier@x.test', name: 'Earlier Person' };
    const LATER = { ...AKRAM, address: 'later@x.test', name: 'Later Person' };
    let answerEarly: (v: unknown) => void = () => {};
    vi.mocked(emailsApi.suggest)
      .mockImplementationOnce(() => new Promise((resolve) => { answerEarly = resolve; }) as never)
      .mockResolvedValueOnce(answer([LATER]));
    const { input } = renderBar();

    await user.type(input, 'hi');
    await waitFor(() => expect(emailsApi.suggest).toHaveBeenCalledTimes(1), WAIT);
    await user.type(input, 'c');
    expect(await screen.findByRole('option', { name: /Later Person/ }, WAIT)).toBeInTheDocument();

    answerEarly(answer([EARLIER]));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('option', { name: /Earlier Person/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Later Person/ })).toBeInTheDocument();
  });

  it('names the person picked in a With chip, and removing it clears them', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderBar({ ...BASE, participant: 'h@x.test', participantName: 'Hicham' });

    expect(screen.getByText('With: Hicham')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove filter' }));
    expect(onFiltersChange.mock.calls[0][0]).toMatchObject({ participant: '', participantName: '' });
  });

  it('shows the address in the chip when the person has no name', () => {
    renderBar({ ...BASE, participant: 'h@x.test' });
    expect(screen.getByText('With: h@x.test')).toBeInTheDocument();
  });

  it('fills From with people from the mail — someone on gmail.com too', async () => {
    // The contacts list the field used to search is filed by company, so an
    // address like this one could never be picked.
    const user = userEvent.setup();
    vi.mocked(emailsApi.suggest).mockResolvedValue(answer([AKRAM]));
    const { container, onFiltersChange } = renderBar({ ...BASE, folder: 'sent' });

    await user.click(container.querySelector('.mail-search__filter-btn')!);
    await user.type(screen.getByRole('combobox', { name: 'From' }), 'akram');
    await user.click(await screen.findByRole('option', { name: 'akramafkir@gmail.test' }, WAIT));
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(onFiltersChange.mock.calls[0][0]).toMatchObject({ from: 'akramafkir@gmail.test', folder: 'sent' });
  });
});

describe('searchScope', () => {
  it('widens the Inbox to all mail for a search, and for nothing else', () => {
    expect(searchScope({ ...BASE, folder: 'inbox', search: 'x' }).folder).toBeNull();
    expect(searchScope({ ...BASE, folder: 'inbox', participant: 'a@b.test' }).folder).toBeNull();
    expect(searchScope({ ...BASE, folder: 'inbox', from: 'a@b.test' }).folder).toBeNull();
    expect(searchScope({ ...BASE, folder: 'inbox', to: 'a@b.test' }).folder).toBeNull();
    expect(searchScope({ ...BASE, folder: 'inbox', subject: 'x' }).folder).toBeNull();
    // Unread is a view of the Inbox, not a search of all mail.
    expect(searchScope({ ...BASE, folder: 'inbox', isRead: 'false' }).folder).toBe('inbox');
    expect(searchScope({ ...BASE, folder: 'inbox', search: '   ' }).folder).toBe('inbox');
    expect(searchScope({ ...BASE, folder: 'sent', search: 'x' }).folder).toBe('sent');
  });
});
