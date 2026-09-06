import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { tasksApi } from '../../api/tasks';
import { searchApi } from '../../api/search';
import { TaskLinks } from './TaskLinks';
import { LinkedTasks } from './LinkedTasks';
import type { Task } from '../../types/task';

/**
 * Linking a task to a contact, deal or event, and the reverse list.
 *
 * The picker is the global search flattened to rows; what matters is that a
 * pick sends the right type and id, that already-linked records are not
 * offered again, and that the reverse list asks for exactly one record.
 */

vi.mock('../../api/tasks', () => ({
  tasksApi: { addLink: vi.fn(), removeLink: vi.fn(), getLinkedTo: vi.fn() },
}));
vi.mock('../../api/search', () => ({ searchApi: { search: vi.fn() } }));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Renew',
    description: null,
    status: 'OPEN',
    priority: 'MEDIUM',
    dueDate: null,
    startDate: null,
    remindAt: null,
    reminderSentAt: null,
    position: 0,
    customerId: null,
    assignedToId: null,
    assignedTo: null,
    estimatedMinutes: null,
    userId: 'me',
    createdAt: '',
    updatedAt: '',
    labels: [],
    customer: null,
    parentId: null,
    parent: null,
    subtaskCount: 0,
    subtaskDoneCount: 0,
    checklistCount: 0,
    checklistDoneCount: 0,
    blockedByCount: 0,
    openBlockerCount: 0,
    blocksCount: 0,
    linkCount: 0,
    trackedMinutes: 0,
    recurrence: null,
    recurrenceNextId: null,
    ...overrides,
  } as Task;
}

const RESULTS = {
  emails: [],
  tasks: [],
  customers: [],
  contacts: [{ id: 'sam', firstName: 'Sam', lastName: 'Lee', email: 'sam@acme.test', role: null, customerId: 'c', customer: { name: 'Acme' } }],
  deals: [{ id: 'deal-1', title: 'Acme renewal', status: 'APPROVED', expiryDate: null, partner: { name: 'HPE' }, customer: null }],
  events: [{ id: 'ev-1', title: 'Kickoff', startTime: '2026-09-10T09:00:00.000Z', endTime: '2026-09-10T10:00:00.000Z', location: null }],
};

describe('TaskLinks', () => {
  beforeEach(() => {
    vi.mocked(searchApi.search).mockReset();
    vi.mocked(tasksApi.addLink).mockReset();
    vi.mocked(tasksApi.removeLink).mockReset();
  });

  it('searches all three types, hides what is already linked, and links the pick', async () => {
    vi.mocked(searchApi.search).mockResolvedValue(axiosOk({ data: RESULTS }));
    vi.mocked(tasksApi.addLink).mockResolvedValue(axiosOk({ data: makeTask() }));
    const onChanged = vi.fn();
    const task = makeTask({ links: [{ entityType: 'deal', entityId: 'deal-1', label: 'Acme renewal', subtitle: 'HPE', when: null }], linkCount: 1 });
    render(
      <MemoryRouter>
        <TaskLinks task={task} onChanged={onChanged} />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByPlaceholderText('Link a contact, deal or event…'), 'ac');

    await waitFor(() => expect(searchApi.search).toHaveBeenCalledWith('ac'));
    const sam = await screen.findByRole('option', { name: /Sam Lee/ });
    expect(screen.getByRole('option', { name: /Kickoff/ })).toBeInTheDocument();
    // Already linked: not offered again.
    expect(screen.queryByRole('option', { name: /Acme renewal/ })).toBeNull();

    await userEvent.click(sam);
    await waitFor(() => expect(tasksApi.addLink).toHaveBeenCalledWith('t1', 'contact', 'sam'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('unlinks a record', async () => {
    vi.mocked(tasksApi.removeLink).mockResolvedValue(axiosOk({ data: makeTask() }));
    const task = makeTask({ links: [{ entityType: 'event', entityId: 'ev-1', label: 'Kickoff', subtitle: null, when: '2026-09-10T09:00:00.000Z' }], linkCount: 1 });
    render(
      <MemoryRouter>
        <TaskLinks task={task} onChanged={vi.fn()} />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Unlink: Kickoff' }));
    await waitFor(() => expect(tasksApi.removeLink).toHaveBeenCalledWith('t1', 'event', 'ev-1'));
  });
});

describe('LinkedTasks', () => {
  beforeEach(() => {
    vi.mocked(tasksApi.getLinkedTo).mockReset();
  });

  it('asks for the tasks linked to one record and reports the count', async () => {
    vi.mocked(tasksApi.getLinkedTo).mockResolvedValue(
      axiosOk({ data: [makeTask({ id: 'a', title: 'Send the deck' }), makeTask({ id: 'b', title: 'Book the room' })] })
    );
    const onCount = vi.fn();
    render(
      <MemoryRouter>
        <LinkedTasks entityType="contact" entityId="sam" onCount={onCount} />
      </MemoryRouter>
    );

    expect(await screen.findByText('Send the deck')).toBeInTheDocument();
    expect(tasksApi.getLinkedTo).toHaveBeenCalledWith('contact', 'sam');
    expect(onCount).toHaveBeenCalledWith(2);
  });

  it('shows an empty state when nothing is linked — one line in a panel, a full one on a page', async () => {
    vi.mocked(tasksApi.getLinkedTo).mockResolvedValue(axiosOk({ data: [] }));
    const { unmount } = render(
      <MemoryRouter>
        <LinkedTasks entityType="event" entityId="ev-1" size="sm" />
      </MemoryRouter>
    );
    expect(await screen.findByText('No tasks linked to this event yet.')).toBeInTheDocument();
    expect(screen.queryByText('No tasks')).toBeNull();
    unmount();

    render(
      <MemoryRouter>
        <LinkedTasks entityType="contact" entityId="c-1" />
      </MemoryRouter>
    );
    expect(await screen.findByText('No tasks')).toBeInTheDocument();
  });
});
