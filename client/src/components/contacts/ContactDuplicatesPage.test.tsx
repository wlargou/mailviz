import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ContactDuplicatesPage } from './ContactDuplicatesPage';
import { contactsApi } from '../../api/customers';
import type { DuplicateGroup } from '../../types/customer';

/**
 * The review-and-merge flow.
 *
 * A merge deletes contact rows irreversibly, so the properties worth locking
 * down are all about restraint: rendering a candidate group must not merge
 * anything, and the confirmation step must name every row it is about to
 * delete. A UI regression here is silent data loss, not a visual glitch.
 */

vi.mock('../../api/customers', () => ({
  contactsApi: {
    getDuplicates: vi.fn(),
    merge: vi.fn(),
  },
}));

const addNotification = vi.fn();
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: (state: { addNotification: typeof addNotification }) => unknown) =>
    selector({ addNotification }),
}));

const KEEP_ID = 'c-keep';
const DROP_ID = 'c-drop';

function group(overrides: Partial<DuplicateGroup> = {}): DuplicateGroup {
  const base = {
    id: `${KEEP_ID}_${DROP_ID}`,
    customer: { id: 'cu-1', name: 'DELL', domain: 'dell.com', logoUrl: null },
    confidence: 'medium' as const,
    rules: ['alias_local_part' as const],
    reasons: ['Same address written differently, same domain, same name'],
    suggestedPrimaryId: KEEP_ID,
    contacts: [
      {
        id: KEEP_ID,
        firstName: 'Sara',
        lastName: 'Maach',
        email: 'sara.maach@dell.com',
        phone: null,
        role: null,
        isVip: false,
        customerId: 'cu-1',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        emailCount: 12,
        aliasEmails: [],
      },
      {
        id: DROP_ID,
        firstName: 'Sara',
        lastName: 'Maach',
        email: 'sara_maach@dell.com',
        phone: null,
        role: null,
        isVip: false,
        customerId: 'cu-1',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        emailCount: 3,
        aliasEmails: [],
      },
    ],
  };
  return { ...base, ...overrides };
}

function mockDuplicates(groups: DuplicateGroup[]) {
  vi.mocked(contactsApi.getDuplicates).mockResolvedValue({
    data: { data: groups, meta: { page: 1, limit: 10, total: groups.length, totalPages: 1 } },
  } as Awaited<ReturnType<typeof contactsApi.getDuplicates>>);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ContactDuplicatesPage />
    </MemoryRouter>
  );
}

describe('ContactDuplicatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(contactsApi.merge).mockResolvedValue({
      data: { data: { contact: {}, mergedContactIds: [DROP_ID], aliasEmailsAdded: ['sara_maach@dell.com'], fieldsAdopted: {} } },
    } as unknown as Awaited<ReturnType<typeof contactsApi.merge>>);
  });

  it('shows each candidate group with the reason it was proposed', async () => {
    mockDuplicates([group()]);
    renderPage();

    expect(await screen.findByText('DELL')).toBeInTheDocument();
    expect(
      screen.getByText('Same address written differently, same domain, same name')
    ).toBeInTheDocument();
    expect(screen.getByText('sara.maach@dell.com')).toBeInTheDocument();
    expect(screen.getByText('sara_maach@dell.com')).toBeInTheDocument();
  });

  it('merges nothing on its own — REGRESSION GUARD', async () => {
    mockDuplicates([group()]);
    renderPage();

    await screen.findByText(/Same address written differently/);
    // Rendering a group, and even pressing the group's own button, must not
    // call the API: the modal is the only thing that can.
    expect(contactsApi.merge).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /merge 1 into selected/i }));

    expect(await screen.findByText('This cannot be undone')).toBeInTheDocument();
    expect(contactsApi.merge).not.toHaveBeenCalled();
  });

  it('names what is kept and what is deleted before confirming', async () => {
    mockDuplicates([group()]);
    renderPage();

    await screen.findByText(/Same address written differently/);
    await userEvent.click(screen.getByRole('button', { name: /merge 1 into selected/i }));

    expect(await screen.findByText(/Sara Maach — sara\.maach@dell\.com/)).toBeInTheDocument();
    expect(screen.getByText(/Sara Maach — sara_maach@dell\.com \(3 emails\)/)).toBeInTheDocument();
  });

  it('merges only the confirmed rows into the chosen survivor', async () => {
    mockDuplicates([group()]);
    renderPage();

    await screen.findByText(/Same address written differently/);
    await userEvent.click(screen.getByRole('button', { name: /merge 1 into selected/i }));
    await screen.findByText('This cannot be undone');
    await userEvent.click(screen.getByRole('button', { name: /merge and delete 1/i }));

    await waitFor(() =>
      expect(contactsApi.merge).toHaveBeenCalledWith({ targetId: KEEP_ID, sourceIds: [DROP_ID] })
    );
  });

  it('follows the survivor when the user picks the other row', async () => {
    mockDuplicates([group()]);
    renderPage();

    await screen.findByText(/Same address written differently/);
    // Choosing the other contact must flip which row is deleted, not merge the
    // survivor into itself.
    await userEvent.click(screen.getByRole('radio', { name: /sara_maach@dell\.com/ }));
    await userEvent.click(screen.getByRole('button', { name: /merge 1 into selected/i }));
    await screen.findByText('This cannot be undone');
    await userEvent.click(screen.getByRole('button', { name: /merge and delete 1/i }));

    await waitFor(() =>
      expect(contactsApi.merge).toHaveBeenCalledWith({ targetId: DROP_ID, sourceIds: [KEEP_ID] })
    );
  });

  it('says so when there is nothing to review', async () => {
    mockDuplicates([]);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'No duplicates found' })).toBeInTheDocument();
  });
});
