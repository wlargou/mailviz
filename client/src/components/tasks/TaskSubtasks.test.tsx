import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { tasksApi } from '../../api/tasks';
import { TaskSubtasks } from './TaskSubtasks';
import { TaskChecklist } from './TaskChecklist';
import { useTaskStore } from '../../store/taskStore';
import type { Task, TaskStatusConfig, ChecklistItem } from '../../types/task';

/**
 * The subtask and checklist sections of the edit panel.
 *
 * Both write immediately rather than through the panel's Save, so what these
 * pin is the payload each control sends: a new subtask carries the parent's
 * id, and "done" is the account's terminal status — not the literal DONE —
 * which is the difference between a checkbox that works for an account whose
 * finished state is called "Shipped" and one that silently does nothing.
 */

vi.mock('../../api/tasks', () => ({
  tasksApi: {
    create: vi.fn(),
    update: vi.fn(),
    addChecklistItem: vi.fn(),
    updateChecklistItem: vi.fn(),
    deleteChecklistItem: vi.fn(),
  },
}));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'parent-1',
    title: 'Renew the contract',
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
    userId: 'user-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
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
    recurrence: null,
    recurrenceNextId: null,
    ...overrides,
  } as Task;
}

const STATUSES: TaskStatusConfig[] = [
  { id: 's1', name: 'OPEN', label: 'Open', color: '#4589ff', position: 0, isTerminal: false, createdAt: '' },
  { id: 's2', name: 'SHIPPED', label: 'Shipped', color: '#24a148', position: 1, isTerminal: true, createdAt: '' },
];

describe('TaskSubtasks', () => {
  beforeEach(() => {
    vi.mocked(tasksApi.create).mockReset();
    vi.mocked(tasksApi.update).mockReset();
    useTaskStore.setState({ tasksVersion: 0 });
  });

  it('adds a subtask under the open task and asks the panel to reload', async () => {
    vi.mocked(tasksApi.create).mockResolvedValue(axiosOk({ data: makeTask({ id: 'child' }) }));
    const onChanged = vi.fn();
    render(<TaskSubtasks task={makeTask()} statuses={STATUSES} onChanged={onChanged} />);

    await userEvent.type(screen.getByPlaceholderText('Add a subtask…'), 'Draft terms{Enter}');

    await waitFor(() => expect(tasksApi.create).toHaveBeenCalledWith({ title: 'Draft terms', parentId: 'parent-1' }));
    expect(onChanged).toHaveBeenCalled();
    // Every view refetches on a task write.
    expect(useTaskStore.getState().tasksVersion).toBe(1);
    expect((screen.getByPlaceholderText('Add a subtask…') as HTMLInputElement).value).toBe('');
  });

  it('ticking a subtask moves it to the account\'s terminal status, not DONE', async () => {
    vi.mocked(tasksApi.update).mockResolvedValue(axiosOk({ data: makeTask() }));
    const child = makeTask({ id: 'child', title: 'Draft terms', status: 'OPEN', parentId: 'parent-1' });
    render(
      <TaskSubtasks
        task={makeTask({ subtasks: [child], subtaskCount: 1 })}
        statuses={STATUSES}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText('0 of 1 done')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Mark done: Draft terms'));

    await waitFor(() => expect(tasksApi.update).toHaveBeenCalledWith('child', { status: 'SHIPPED' }));
  });

  it('unticking a finished subtask reopens it into the first non-terminal status', async () => {
    vi.mocked(tasksApi.update).mockResolvedValue(axiosOk({ data: makeTask() }));
    const child = makeTask({ id: 'child', title: 'Draft terms', status: 'SHIPPED', parentId: 'parent-1' });
    render(
      <TaskSubtasks
        task={makeTask({ subtasks: [child], subtaskCount: 1, subtaskDoneCount: 1 })}
        statuses={STATUSES}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText('1 of 1 done')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Reopen: Draft terms'));

    await waitFor(() => expect(tasksApi.update).toHaveBeenCalledWith('child', { status: 'OPEN' }));
  });

  it('with no terminal status the checkbox is disabled and says why', () => {
    const child = makeTask({ id: 'child', title: 'Draft terms', parentId: 'parent-1' });
    render(
      <TaskSubtasks
        task={makeTask({ subtasks: [child], subtaskCount: 1 })}
        statuses={[STATUSES[0]]}
        onChanged={vi.fn()}
      />
    );

    const box = screen.getByLabelText('Mark done: Draft terms') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.title).toMatch(/No status is marked as finished/);
  });

  it('a subtask title opens that task', async () => {
    const onOpenTask = vi.fn();
    const child = makeTask({ id: 'child', title: 'Draft &amp; sign', parentId: 'parent-1' });
    render(
      <TaskSubtasks
        task={makeTask({ subtasks: [child], subtaskCount: 1 })}
        statuses={STATUSES}
        onOpenTask={onOpenTask}
        onChanged={vi.fn()}
      />
    );

    // Entities decoded, like every other title in the app.
    await userEvent.click(screen.getByRole('button', { name: 'Draft & sign' }));
    expect(onOpenTask).toHaveBeenCalledWith('child');
  });
});

describe('TaskChecklist', () => {
  beforeEach(() => {
    vi.mocked(tasksApi.addChecklistItem).mockReset();
    vi.mocked(tasksApi.updateChecklistItem).mockReset();
    vi.mocked(tasksApi.deleteChecklistItem).mockReset();
  });

  const item = (overrides: Partial<ChecklistItem> = {}): ChecklistItem => ({
    id: 'i1',
    taskId: 'parent-1',
    text: 'Call Sam',
    isDone: false,
    position: 1000,
    createdAt: '',
    completedAt: null,
    ...overrides,
  });

  it('adds an item and clears the box', async () => {
    vi.mocked(tasksApi.addChecklistItem).mockResolvedValue(axiosOk({ data: item() }));
    const onChanged = vi.fn();
    render(<TaskChecklist taskId="parent-1" items={[]} onChanged={onChanged} />);

    await userEvent.type(screen.getByPlaceholderText('Add an item…'), '  Call Sam {Enter}');

    await waitFor(() => expect(tasksApi.addChecklistItem).toHaveBeenCalledWith('parent-1', 'Call Sam'));
    expect(onChanged).toHaveBeenCalled();
    expect((screen.getByPlaceholderText('Add an item…') as HTMLInputElement).value).toBe('');
  });

  it('does not send a blank line', async () => {
    render(<TaskChecklist taskId="parent-1" items={[]} onChanged={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText('Add an item…'), '   {Enter}');

    expect(tasksApi.addChecklistItem).not.toHaveBeenCalled();
  });

  it('ticks, unticks and removes an item against the right task and item', async () => {
    vi.mocked(tasksApi.updateChecklistItem).mockResolvedValue(axiosOk({ data: item({ isDone: true }) }));
    vi.mocked(tasksApi.deleteChecklistItem).mockResolvedValue(axiosOk(undefined));
    render(
      <TaskChecklist
        taskId="parent-1"
        items={[item(), item({ id: 'i2', text: 'Send deck', isDone: true })]}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText('1 of 2 done')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Tick: Call Sam'));
    await waitFor(() => expect(tasksApi.updateChecklistItem).toHaveBeenCalledWith('parent-1', 'i1', { isDone: true }));

    await userEvent.click(screen.getByLabelText('Untick: Send deck'));
    await waitFor(() => expect(tasksApi.updateChecklistItem).toHaveBeenCalledWith('parent-1', 'i2', { isDone: false }));

    await userEvent.click(screen.getByRole('button', { name: 'Remove: Call Sam' }));
    await waitFor(() => expect(tasksApi.deleteChecklistItem).toHaveBeenCalledWith('parent-1', 'i1'));
  });
});
