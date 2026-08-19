import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ContactsPage } from './ContactsPage';
import { contactsApi } from '../../api/customers';
import type { Contact } from '../../types/customer';

/**
 * The contacts list.
 *
 * Every control on this page is a *query builder*: filtering, sorting and
 * paging all happen on the server, because the page holds twenty of ~11,700
 * rows at a time. That makes the assertions here about the request, not the
 * markup — a filter that renders perfectly and sends the wrong param shows the
 * user a plausible-looking list of the wrong people, which is far worse than a
 * visibly broken control.
 *
 * Three specific failure modes are locked down:
 *
 *  - **Params.** `kind` defaults to `people` and `engagement` to `all`, and
 *    each has its own "means unfiltered" sentinel that must be *omitted* rather
 *    than sent. Sending `kind=all` and sending nothing are different queries.
 *  - **Page reset.** Narrowing the set while on page 3 must go back to page 1.
 *    Otherwise the new, shorter result has no page 3 and the user gets an empty
 *    table for a filter that matched plenty.
 *  - **Debounce.** The search box is deliberately debounced; losing that fires
 *    one request per keystroke against a table this size.
 */

vi.mock('../../api/customers', () => ({
  contactsApi: { getAll: vi.fn() },
  customersApi: { getAll: vi.fn(), getById: vi.fn() },
}));

const addNotification = vi.fn();
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: (state: { addNotification: typeof addNotification }) => unknown) =>
    selector({ addNotification }),
}));

// The company filter is its own component with its own debounced fetch. It is
// covered by its own contract, and stubbing it keeps this file's assertions on
// `contactsApi.getAll` alone.
vi.mock('../shared/CompanyComboBox', () => ({
  CompanyComboBox: () => <div data-testid="company-combobox-stub" />,
}));

// Carbon's Dropdown scrolls its highlighted option into view on open, and jsdom
// implements no scrolling at all. Kept local to this file rather than added to
// the shared setup, which other suites depend on.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

type ContactRow = Contact & { _emailCount?: number };

function contact(id: string, firstName: string, lastName: string): ContactRow {
  return {
    id,
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}@dell.com`,
    phone: null,
    role: null,
    isVip: false,
    customerId: 'cu-1',
    customer: { id: 'cu-1', name: 'DELL', domain: 'dell.com', logoUrl: null },
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    _emailCount: 4,
  };
}

const ROWS = [contact('c1', 'Sara', 'Maach'), contact('c2', 'Omar', 'Benali')];

function mockContacts(rows: ContactRow[] = ROWS, total = rows.length) {
  vi.mocked(contactsApi.getAll).mockResolvedValue({
    data: {
      data: rows,
      meta: { page: 1, limit: 20, total, totalPages: Math.max(1, Math.ceil(total / 20)) },
    },
  } as Awaited<ReturnType<typeof contactsApi.getAll>>);
}

function renderPage(initialEntry = '/contacts') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ContactsPage />
    </MemoryRouter>
  );
}

/** The params object of the most recent `contactsApi.getAll` call. */
function lastParams(): Record<string, string> {
  const calls = vi.mocked(contactsApi.getAll).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as Record<string, string>;
}

async function waitForCallCount(n: number) {
  await waitFor(() => expect(contactsApi.getAll).toHaveBeenCalledTimes(n));
}

/** Every `search` value the page has ever asked the API for, in order. */
function searchesRequested(): string[] {
  return vi
    .mocked(contactsApi.getAll)
    .mock.calls.map((call) => (call[0] as Record<string, string> | undefined)?.search)
    .filter((value): value is string => value !== undefined);
}

/**
 * A sortable column header.
 *
 * Carbon prefixes the accessible name with its own assistive sentence
 * ("Click to sort rows by Email header in ascending order"), which is what
 * distinguishes the `Email` column from the `Emails` count column — plain
 * "Email" matches both.
 */
function sortableHeader(column: string): HTMLElement {
  return screen.getByRole('columnheader', {
    name: new RegExp(`sort rows by ${column} header`, 'i'),
  });
}

/** Opens the filter flyout and picks an option from one of its dropdowns. */
async function chooseFilter(user: ReturnType<typeof userEvent.setup>, label: RegExp, option: string) {
  await user.click(screen.getByRole('button', { name: 'Filter' }));
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('ContactsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContacts();
  });

  describe('initial query', () => {
    it('asks for page 1 sorted by surname, filtered to people', async () => {
      renderPage();
      await waitForCallCount(1);

      expect(lastParams()).toEqual({
        page: '1',
        limit: '20',
        sortBy: 'lastName',
        sortOrder: 'asc',
        kind: 'people',
      });
    });

    it('omits engagement while it means "any correspondence" — REGRESSION', async () => {
      // `engagement=all` is the sentinel for *unfiltered*; the endpoint has no
      // such value. Sending it would filter to nothing, and the page would look
      // like a user with no contacts. It must never appear in the query.
      renderPage();
      await waitForCallCount(1);

      expect(lastParams()).not.toHaveProperty('engagement');
      expect(lastParams()).not.toHaveProperty('search');
      expect(lastParams()).not.toHaveProperty('customerId');
    });

    it('renders the returned rows', async () => {
      renderPage();

      expect(await screen.findByText('Sara Maach')).toBeInTheDocument();
      expect(screen.getByText('Omar Benali')).toBeInTheDocument();
    });

    it('carries a deep-linked search straight into the first request', async () => {
      // Global search navigates here with `?search=`. Dropping it means the
      // user lands on the unfiltered list and has to retype their query.
      renderPage('/contacts?search=maach');
      await waitForCallCount(1);

      expect(lastParams().search).toBe('maach');
    });

    it('notifies rather than blanking the page when the request fails', async () => {
      vi.mocked(contactsApi.getAll).mockRejectedValue(new Error('boom'));
      renderPage();

      await waitFor(() =>
        expect(addNotification).toHaveBeenCalledWith({ kind: 'error', title: 'Failed to load contacts' })
      );
    });
  });

  describe('kind filter', () => {
    it('sends the chosen kind', async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForCallCount(1);

      await chooseFilter(user, /type/i, 'Shared mailboxes');

      await waitForCallCount(2);
      expect(lastParams().kind).toBe('role');
    });

    it('drops the kind param entirely for "All contacts" — REGRESSION', async () => {
      // The one option that means *no* filter. `kind=all` is not a value the
      // endpoint knows, so sending it returns nothing and "All contacts" shows
      // the fewest contacts of any option.
      const user = userEvent.setup();
      renderPage();
      await waitForCallCount(1);

      await chooseFilter(user, /type/i, 'All contacts');

      await waitForCallCount(2);
      expect(lastParams()).not.toHaveProperty('kind');
    });
  });

  describe('engagement filter', () => {
    it('sends the chosen engagement', async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForCallCount(1);

      await chooseFilter(user, /correspondence/i, 'Two-way');

      await waitForCallCount(2);
      expect(lastParams().engagement).toBe('both');
    });

    it('keeps the two filters independent', async () => {
      // They share the page-reset path and are easy to cross-wire; a swap here
      // silently answers a different question than the one asked.
      const user = userEvent.setup();
      renderPage();
      await waitForCallCount(1);

      await chooseFilter(user, /type/i, 'Automated senders');
      await waitForCallCount(2);
      await chooseFilter(user, /correspondence/i, 'Never exchanged');
      await waitForCallCount(3);

      expect(lastParams().kind).toBe('automated');
      expect(lastParams().engagement).toBe('none');
    });
  });

  describe('page reset', () => {
    it('returns to page 1 when a filter narrows the set — REGRESSION', async () => {
      // Narrowing from page 2 without resetting asks for page 2 of a result
      // that may only have one page: an empty table for a filter that matched.
      const user = userEvent.setup();
      mockContacts(ROWS, 45);
      renderPage();
      await waitForCallCount(1);

      await user.click(await screen.findByRole('button', { name: /next page/i }));
      await waitForCallCount(2);
      expect(lastParams().page).toBe('2');

      await chooseFilter(user, /type/i, 'People only');

      await waitForCallCount(3);
      expect(lastParams()).toMatchObject({ page: '1', kind: 'person' });
    });

    it('returns to page 1 when the engagement filter changes', async () => {
      const user = userEvent.setup();
      mockContacts(ROWS, 45);
      renderPage();
      await waitForCallCount(1);

      await user.click(await screen.findByRole('button', { name: /next page/i }));
      await waitForCallCount(2);

      await chooseFilter(user, /correspondence/i, 'They wrote to me');

      await waitForCallCount(3);
      expect(lastParams()).toMatchObject({ page: '1', engagement: 'sender' });
    });

    it('returns to page 1 when the filters are reset', async () => {
      const user = userEvent.setup();
      mockContacts(ROWS, 45);
      renderPage();
      await waitForCallCount(1);

      await chooseFilter(user, /type/i, 'All contacts');
      await waitForCallCount(2);
      await user.click(await screen.findByRole('button', { name: /next page/i }));
      await waitForCallCount(3);

      await user.click(screen.getByRole('button', { name: 'Filter' }));
      await user.click(screen.getByRole('button', { name: /reset filters/i }));

      await waitForCallCount(4);
      expect(lastParams()).toMatchObject({ page: '1', kind: 'people' });
    });
  });

  describe('sorting', () => {
    it('sends sortBy and sortOrder for the clicked column', async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForCallCount(1);

      await screen.findByText('Sara Maach');
      await user.click(within(sortableHeader('Email')).getByRole('button'));

      await waitForCallCount(2);
      // A newly chosen column starts ascending — clicking "Email" and getting
      // Z–A reads as a bug.
      expect(lastParams()).toMatchObject({ sortBy: 'email', sortOrder: 'asc' });
    });

    it('moves the sort indicator to the column the server was asked to sort by', async () => {
      // `aria-sort` is the only thing that tells a screen-reader user which
      // column the list is ordered by. Leaving it on Name while the query says
      // `email` describes the table as something it is not.
      const user = userEvent.setup();
      renderPage();
      await waitForCallCount(1);

      await screen.findByText('Sara Maach');
      expect(sortableHeader('Name')).toHaveAttribute('aria-sort', 'ascending');

      await user.click(within(sortableHeader('Email')).getByRole('button'));

      await waitFor(() => expect(sortableHeader('Email')).toHaveAttribute('aria-sort', 'ascending'));
      expect(sortableHeader('Name')).toHaveAttribute('aria-sort', 'none');
    });

    it('flips direction when the same column is clicked again', async () => {
      const user = userEvent.setup();
      renderPage();
      await waitForCallCount(1);

      await screen.findByText('Sara Maach');
      // Name is already the active column, ascending.
      await user.click(within(sortableHeader('Name')).getByRole('button'));

      await waitForCallCount(2);
      expect(lastParams()).toMatchObject({ sortBy: 'lastName', sortOrder: 'desc' });
    });

    it('sorts Name by the API field, not the column key — REGRESSION', async () => {
      // There is no combined `name` sort field on the endpoint; the column key
      // is `name` but the query has to say `lastName`. Sending the key gets the
      // sort silently ignored (or rejected) while the arrow still moves.
      const user = userEvent.setup();
      renderPage();
      await waitForCallCount(1);

      await screen.findByText('Sara Maach');
      await user.click(within(sortableHeader('Name')).getByRole('button'));

      await waitForCallCount(2);
      expect(lastParams().sortBy).toBe('lastName');
    });

    it('offers no sort affordance on columns the endpoint cannot order by', async () => {
      // Company is a relation and Emails a computed count. An arrow on either
      // is a control that does nothing.
      renderPage();

      const company = await screen.findByRole('columnheader', { name: /company/i });
      const emails = screen.getByRole('columnheader', { name: /^emails$/i });

      expect(within(company).queryByRole('button')).toBeNull();
      expect(within(emails).queryByRole('button')).toBeNull();
    });
  });

  describe('search', () => {
    it('collapses a burst of typing into one request — REGRESSION', async () => {
      // Five characters must not become five queries over ~11,700 contacts.
      // `delay: null` types the burst without artificial pauses, the way a real
      // typist outruns a 300ms debounce.
      const user = userEvent.setup({ delay: null });
      renderPage();
      await waitForCallCount(1);

      await user.type(await screen.findByRole('searchbox'), 'maach');
      // Mid-burst: still nothing beyond the initial load.
      expect(contactsApi.getAll).toHaveBeenCalledTimes(1);

      await waitFor(() => expect(searchesRequested()).toEqual(['maach']));
      // The decisive part. Without the debounce the prefixes 'm', 'ma', 'maa'
      // and 'maac' each get their own query, so this stays green only if
      // exactly one request was ever issued for the whole burst.
      expect(contactsApi.getAll).toHaveBeenCalledTimes(2);
    });

    it('resets to page 1 as soon as the query changes', async () => {
      const user = userEvent.setup({ delay: null });
      mockContacts(ROWS, 45);
      renderPage();
      await waitForCallCount(1);

      await user.click(await screen.findByRole('button', { name: /next page/i }));
      await waitForCallCount(2);

      await user.type(await screen.findByRole('searchbox'), 'maach');

      // The debounced query is the one that matters — the immediate page reset
      // fires its own request first.
      await waitFor(() => expect(lastParams().search).toBe('maach'));
      expect(lastParams().page).toBe('1');
    });

    it('shows "no contacts yet" only when the list is genuinely empty', async () => {
      // With a search term active, an empty result means "nothing matched", not
      // "you have no contacts" — and swapping in the empty state would take the
      // search box away with it, stranding the user.
      mockContacts([], 0);
      renderPage();

      expect(await screen.findByRole('heading', { name: 'No contacts yet' })).toBeInTheDocument();
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    });

    it('keeps the search box when a search returns nothing', async () => {
      const user = userEvent.setup({ delay: null });
      renderPage();
      await waitForCallCount(1);

      mockContacts([], 0);
      await user.type(await screen.findByRole('searchbox'), 'zzz');
      await waitForCallCount(2);

      await waitFor(() => expect(screen.queryByText('Sara Maach')).not.toBeInTheDocument());
      expect(screen.getByRole('searchbox')).toHaveValue('zzz');
      expect(screen.queryByRole('heading', { name: 'No contacts yet' })).not.toBeInTheDocument();
    });
  });
});
