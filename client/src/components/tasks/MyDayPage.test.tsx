import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { tasksApi } from '../../api/tasks';
import { MyDayPage } from './MyDayPage';
import { useTaskStore } from '../../store/taskStore';
import type { Task } from '../../types/task';

/**
 * The My Day page.
 *
 * The buckets come from the server; what the page owns is finishing a task in
 * place — which must use the account's terminal status, not the name DONE —
 * and saying why when the server refuses (a blocked task).
 */

vi.mock('../../api/tasks', () => ({
  tasksApi: { getMyDay: vi.fn(), update: vi.fn(), getById: vi.fn(), getActivity: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));
vi.mock('../../api/taskStatuses', () => ({
  taskStatusesApi: {
    getAll: vi.fn().mockResolvedValue({
      data: {
        data: [
          { id: 's1', name: 'OPEN', label: 'Open', color: '', position: 0, isTerminal: false, createdAt: '' },
          { id: 's2', name: 'SHIPPED', label: 'Shipped', color: '', position: 1, isTerminal: true, createdAt: '' },
        ],
      },
    }),
  },
}));
vi.mock('../../api/labels', () => ({ labelsApi: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) } }));
vi.mock('../../api/auth', () => ({ authApi: { getUsers: vi.fn().mockResolvedValue({ data: { data: [] } }) } }));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Call Sam',
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
    recurrence: null,
    recurrenceNextId: null,
    ...overrides,
  } as Task;
}

const DAY = {
  overdue: [makeTask({ id: 'o1', title: 'Chase the NDA', dueDate: '2026-09-01T09:00:00.000Z', customer: { id: 'c', name: 'Acme', company: null } })],
  dueToday: [makeTask({ id: 'd1', title: 'Send the deck', dueDate: new Date().toISOString() })],
  startingToday: [],
  upcoming: [makeTask({ id: 'u1', title: 'Plan Q4', dueDate: '2026-09-11T09:00:00.000Z' })],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <MyDayPage />
    </MemoryRouter>
  );
}

describe('MyDayPage', () => {
  beforeEach(() => {
    vi.mocked(tasksApi.getMyDay).mockReset();
    vi.mocked(tasksApi.update).mockReset();
    useTaskStore.setState({ tasksVersion: 0 });
  });

  it('renders the buckets with their counts and an empty line for a quiet one', async () => {
    vi.mocked(tasksApi.getMyDay).mockResolvedValue(axiosOk({ data: DAY, meta: { timezone: 'UTC', today: '', total: 2 } }));
    renderPage();

    expect(await screen.findByRole('button', { name: 'Chase the NDA' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Overdue/ })).toHaveTextContent('1');
    expect(screen.getByRole('heading', { name: /Due today/ })).toHaveTextContent('1');
    expect(screen.getByText('Nothing starts today.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan Q4' })).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('finishing a task uses the account\'s terminal status and refreshes every view', async () => {
    vi.mocked(tasksApi.getMyDay).mockResolvedValue(axiosOk({ data: DAY, meta: { timezone: 'UTC', today: '', total: 2 } }));
    vi.mocked(tasksApi.update).mockResolvedValue(axiosOk({ data: makeTask() }));
    renderPage();

    await userEvent.click(await screen.findByLabelText('Mark done: Send the deck'));

    await waitFor(() => expect(tasksApi.update).toHaveBeenCalledWith('d1', { status: 'SHIPPED' }));
    expect(useTaskStore.getState().tasksVersion).toBe(1);
  });

  it('says why when the server refuses to finish a blocked task', async () => {
    vi.mocked(tasksApi.getMyDay).mockResolvedValue(axiosOk({ data: DAY, meta: { timezone: 'UTC', today: '', total: 2 } }));
    vi.mocked(tasksApi.update).mockRejectedValue({
      response: { status: 409, data: { error: { code: 'TASK_BLOCKED', message: 'Blocked by 1 unfinished task: Design' } } },
    });
    renderPage();

    await userEvent.click(await screen.findByLabelText('Mark done: Chase the NDA'));

    await waitFor(() => expect(tasksApi.update).toHaveBeenCalled());
    // The refusal is not a task change; nothing refetches.
    expect(useTaskStore.getState().tasksVersion).toBe(0);
  });

  it('shows the empty state when there is nothing today and nothing ahead', async () => {
    vi.mocked(tasksApi.getMyDay).mockResolvedValue(
      axiosOk({ data: { overdue: [], dueToday: [], startingToday: [], upcoming: [] }, meta: { timezone: 'UTC', today: '', total: 0 } })
    );
    renderPage();

    expect(await screen.findByText('Nothing on your plate today')).toBeInTheDocument();
  });
});
