import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { tasksApi } from '../../api/tasks';
import { TaskListView } from './TaskListView';
import { TaskViewsMenu } from './TaskViewsMenu';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import type { Task } from '../../types/task';

/**
 * Batch actions on the task list, and saved views.
 *
 * The rows a batch sends are the selected ids; what the toast says is the
 * server's count and the first skip reason. A saved view replaces the
 * store's filters wholesale.
 */

vi.mock('../../api/tasks', () => ({
  tasksApi: {
    getTaskShares: vi.fn(),
    batchStatus: vi.fn(),
    batchAssign: vi.fn(),
    batchLabel: vi.fn(),
    batchDelete: vi.fn(),
    getViews: vi.fn(),
    saveView: vi.fn(),
    deleteView: vi.fn(),
  },
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
vi.mock('../../api/auth', () => ({ authApi: { getUsers: vi.fn().mockResolvedValue({ data: { data: [{ id: 'sam', name: 'Sam', email: 's@example.com' }] } }) } }));

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

const TASKS = [makeTask({ id: 'a', title: 'Alpha' }), makeTask({ id: 'b', title: 'Beta' }), makeTask({ id: 'c', title: 'Gamma' })];

function renderList() {
  return render(
    <TaskListView tasks={TASKS} loading={false} labels={[{ id: 'l1', name: 'Ops', color: '#000' } as never]} onEdit={vi.fn()} onDelete={vi.fn()} onCreateNew={vi.fn()} />
  );
}

describe('TaskListView — batch actions', () => {
  beforeEach(() => {
    vi.mocked(tasksApi.batchStatus).mockReset();
    vi.mocked(tasksApi.batchLabel).mockReset();
    vi.mocked(tasksApi.getViews).mockResolvedValue(axiosOk({ data: [] }));
    useTaskStore.setState({ tasksVersion: 0, filters: { sortBy: 'createdAt', sortOrder: 'desc' } as never, meta: null });
    useUIStore.setState({ notifications: [] } as never);
  });

  it('completes the selected rows through the terminal status and reports a skip', async () => {
    vi.mocked(tasksApi.batchStatus).mockResolvedValue(
      axiosOk({ data: { updated: 1, skipped: [{ id: 'b', reason: 'Blocked by Design' }] } })
    );
    renderList();

    const boxes = await screen.findAllByRole('checkbox');
    // First is select-all; then one per row.
    await userEvent.click(boxes[1]!);
    await userEvent.click(boxes[2]!);
    await userEvent.click(screen.getByRole('button', { name: 'Complete' }));

    await waitFor(() => expect(tasksApi.batchStatus).toHaveBeenCalledWith(['a', 'b'], 'SHIPPED'));
    const shown = useUIStore.getState().notifications as Array<{ kind: string; title: string; subtitle?: string }>;
    expect(shown[0]).toMatchObject({ kind: 'warning', title: 'Finished 1 task', subtitle: '1 skipped: Blocked by Design' });
    expect(useTaskStore.getState().tasksVersion).toBe(1);
  });

  it('labels the selection with the picked label', async () => {
    vi.mocked(tasksApi.batchLabel).mockResolvedValue(axiosOk({ data: { updated: 3, skipped: [] } }));
    renderList();

    await userEvent.click((await screen.findAllByRole('checkbox'))[0]!); // select all
    await userEvent.click(screen.getByRole('button', { name: 'Add label…' }));
    const dialog = await screen.findByRole('dialog', { name: /Add a label to 3 tasks/ });
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await within(dialog).findByRole('option', { name: 'Ops' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(tasksApi.batchLabel).toHaveBeenCalledWith(['a', 'b', 'c'], 'l1'));
  });
});

describe('TaskViewsMenu', () => {
  beforeEach(() => {
    vi.mocked(tasksApi.getViews).mockReset();
    vi.mocked(tasksApi.saveView).mockReset();
    useTaskStore.setState({ filters: { sortBy: 'createdAt', sortOrder: 'desc', priority: 'URGENT' } as never });
  });

  it('applying a saved view replaces the filters and the sort', async () => {
    vi.mocked(tasksApi.getViews).mockResolvedValue(
      axiosOk({ data: [{ id: 'v1', name: 'Blocked, mine', filters: { blocked: 'true', ownership: 'owned' }, sortBy: 'dueDate', sortOrder: 'asc', position: 0, createdAt: '', updatedAt: '' }] })
    );
    render(<TaskViewsMenu />);

    await userEvent.click(await screen.findByRole('button', { name: 'Views' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Blocked, mine' }));

    const { filters } = useTaskStore.getState();
    expect(filters).toMatchObject({ blocked: 'true', ownership: 'owned', sortBy: 'dueDate', sortOrder: 'asc' });
    // The previous priority filter is gone: a view is the whole state.
    expect(filters.priority).toBeUndefined();
  });

  it('saves the current filters under a name', async () => {
    vi.mocked(tasksApi.getViews).mockResolvedValue(axiosOk({ data: [] }));
    vi.mocked(tasksApi.saveView).mockResolvedValue(axiosOk({ data: {} as never }));
    render(<TaskViewsMenu />);

    await userEvent.click(await screen.findByRole('button', { name: 'Save view' }));
    await userEvent.type(screen.getByLabelText('View name'), 'Fires{Enter}');

    await waitFor(() =>
      expect(tasksApi.saveView).toHaveBeenCalledWith({ name: 'Fires', filters: { priority: 'URGENT' }, sortBy: 'createdAt', sortOrder: 'desc' })
    );
  });
});
