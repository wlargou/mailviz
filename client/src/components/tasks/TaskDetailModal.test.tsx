import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { tasksApi } from '../../api/tasks';
import { TaskDetailModal } from './TaskDetailModal';
import { useTaskStore } from '../../store/taskStore';
import type { Task, Label } from '../../types/task';

/**
 * The edit panel.
 *
 * It used to be handed a whole `Task` captured when the row was clicked. That
 * one decision caused three separate defects, and these pin all three:
 *
 *  - the object went stale, and this form PATCHes every field, so saving wrote
 *    old values back over newer ones;
 *  - two of the three views fetch from an endpoint that omits `mailToTask`, so
 *    what the panel could render depended on which tab you opened it from;
 *  - the label field mounted one render BEFORE the values were seeded, and
 *    Carbon's `MultiSelect` here is uncontrolled, so it showed the *previous*
 *    task's labels — which the next save would write.
 */

vi.mock('../../api/tasks', () => ({
  tasksApi: { getById: vi.fn(), update: vi.fn(), assignTask: vi.fn(), getTaskShares: vi.fn() },
}));
vi.mock('../../api/taskStatuses', () => ({
  taskStatusesApi: {
    getAll: vi.fn().mockResolvedValue({
      data: { data: [{ id: 's1', name: 'TODO', label: 'To do', color: '#4589ff', position: 0, isTerminal: false, createdAt: '' }] },
    }),
  },
}));
vi.mock('../../api/auth', () => ({ authApi: { getUsers: vi.fn().mockResolvedValue({ data: { data: [] } }) } }));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

const LABELS: Label[] = [
  { id: 'l1', name: 'Billing', color: '#d02670' },
  { id: 'l2', name: 'Presales', color: '#0f62fe' },
  { id: 'l3', name: 'Support', color: '#007d79' },
] as Label[];

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Renew the contract',
    description: null,
    status: 'TODO',
    priority: 'MEDIUM',
    dueDate: null,
    position: 0,
    customerId: null,
    assignedToId: null,
    assignedTo: null,
    estimatedMinutes: null,
    userId: 'user-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    labels: [],
    customer: null,
    ...overrides,
  } as Task;
}

/**
 * How many labels the field is showing.
 *
 * Read off Carbon's selection badge rather than by text, because the panel also
 * renders a date picker and `getByText('2')` matches the 2nd of the month.
 */
function shownLabelCount(): number {
  // Carbon renders the count as a filter Tag inside the field.
  const badge = document.querySelector('.cds--multi-select .cds--tag__label');
  const n = Number(badge?.textContent?.trim());
  return Number.isFinite(n) ? n : 0;
}

function renderPanel(taskId: string | null) {
  return render(
    <TaskDetailModal
      taskId={taskId}
      open={!!taskId}
      onClose={vi.fn()}
      onUpdated={vi.fn()}
      labels={LABELS}
    />
  );
}

const initial = useTaskStore.getState();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tasksApi.getById).mockReset();
  useTaskStore.setState(initial, true);
});

describe('TaskDetailModal', () => {
  it('fetches the task it was asked for instead of being handed one', async () => {
    vi.mocked(tasksApi.getById).mockResolvedValue(axiosOk({ data: makeTask({ title: 'Fresh from the server' }) }));

    renderPanel('task-1');

    expect(await screen.findByDisplayValue('Fresh from the server')).toBeInTheDocument();
    expect(tasksApi.getById).toHaveBeenCalledWith('task-1');
  });

  it('shows the labels the task actually has', async () => {
    // The first half of the uncontrolled-MultiSelect bug: because the field
    // mounted before the seed ran, the FIRST task opened showed an empty Labels
    // control however many labels it had.
    vi.mocked(tasksApi.getById).mockResolvedValue(
      axiosOk({ data: makeTask({ labels: [LABELS[0], LABELS[1]] }) })
    );

    renderPanel('task-1');

    await screen.findByDisplayValue('Renew the contract');
    expect(shownLabelCount()).toBe(2);
  });

  it('does not show the previous task’s labels when a different task is opened', async () => {
    // The second half, and the one that lost data: opening a labelled task and
    // then an unlabelled one left the earlier task's chips in the field. Touch
    // the control and save, and those labels were written onto a task that
    // never had them.
    const user = userEvent.setup();
    vi.mocked(tasksApi.getById).mockResolvedValue(
      axiosOk({ data: makeTask({ id: 'labelled', labels: [LABELS[0], LABELS[1]] }) })
    );
    const { rerender } = renderPanel('labelled');
    await waitFor(() => expect(shownLabelCount()).toBe(2));

    vi.mocked(tasksApi.getById).mockResolvedValue(
      axiosOk({ data: makeTask({ id: 'bare', title: 'No labels here', labels: [] }) })
    );
    rerender(
      <TaskDetailModal taskId="bare" open onClose={vi.fn()} onUpdated={vi.fn()} labels={LABELS} />
    );

    await screen.findByDisplayValue('No labels here');
    expect(shownLabelCount()).toBe(0);
    await user.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => expect(tasksApi.update).toHaveBeenCalled());
    expect(vi.mocked(tasksApi.update).mock.calls[0][1]).toMatchObject({ labelIds: [] });
  });

  it('closes and announces when the task has been deleted underneath it', async () => {
    const onClose = vi.fn();
    vi.mocked(tasksApi.getById).mockRejectedValue({ response: { status: 404 } });

    render(
      <TaskDetailModal taskId="gone" open onClose={onClose} onUpdated={vi.fn()} labels={LABELS} />
    );

    // And the lists are told, so the row the user clicked stops being offered.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useTaskStore.getState().tasksVersion).toBe(1);
  });

  it('offers a retry rather than an empty form when the load fails', async () => {
    vi.mocked(tasksApi.getById).mockRejectedValue({ response: { status: 500 } });

    renderPanel('task-1');

    expect(await screen.findByText('Could not load this task')).toBeInTheDocument();
    // Never a form seeded with nothing — that is how a blank Save wipes a task.
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });
});
