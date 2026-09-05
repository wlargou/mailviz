import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { tasksApi } from '../../api/tasks';
import { TaskDependencies } from './TaskDependencies';
import { TaskProgressTags } from './TaskProgressTags';
import type { Task, TaskStatusConfig } from '../../types/task';

/**
 * The dependencies section and the Blocked tag.
 *
 * "Blocked" means an unfinished blocker by the account's terminal statuses,
 * so a blocker in a status called "Shipped" must read as finished here even
 * though its name is not DONE — the same rule the server applies to the gate.
 */

vi.mock('../../api/tasks', () => ({
  tasksApi: { getAll: vi.fn(), addDependency: vi.fn(), removeDependency: vi.fn() },
}));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'build',
    title: 'Build',
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
    recurrence: null,
    recurrenceNextId: null,
    ...overrides,
  } as Task;
}

const STATUSES: TaskStatusConfig[] = [
  { id: 's1', name: 'OPEN', label: 'Open', color: '', position: 0, isTerminal: false, createdAt: '' },
  { id: 's2', name: 'SHIPPED', label: 'Shipped', color: '', position: 1, isTerminal: true, createdAt: '' },
];

describe('TaskDependencies', () => {
  beforeEach(() => {
    vi.mocked(tasksApi.getAll).mockReset();
    vi.mocked(tasksApi.addDependency).mockReset();
    vi.mocked(tasksApi.removeDependency).mockReset();
  });

  it('lists blockers with their finished state by the terminal statuses, and what this task blocks', () => {
    const task = makeTask({
      blockedBy: [
        { id: 'design', title: 'Design', status: 'OPEN' },
        { id: 'legal', title: 'Legal &amp; sign-off', status: 'SHIPPED' },
      ],
      blocks: [{ id: 'launch', title: 'Launch', status: 'OPEN' }],
      blockedByCount: 2,
      openBlockerCount: 1,
    });
    render(<TaskDependencies task={task} statuses={STATUSES} onChanged={vi.fn()} />);

    expect(screen.getByText('Blocked by 1 of 2')).toBeInTheDocument();
    // Design (open blocker) and Launch (open, in Blocks) are unfinished; Legal is finished.
    expect(screen.getAllByTitle('Not finished')).toHaveLength(2);
    expect(screen.getAllByTitle('Finished')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Legal & sign-off' }).closest('li')).toHaveClass('task-section__item--done');
    expect(screen.getByText('Blocks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Launch' })).toBeInTheDocument();
    // Blocks is read-only: no remove control for Launch.
    expect(screen.queryByRole('button', { name: 'Remove blocker: Launch' })).toBeNull();
  });

  it('removes a blocker and asks the panel to reload', async () => {
    vi.mocked(tasksApi.removeDependency).mockResolvedValue(axiosOk({ data: makeTask() }));
    const onChanged = vi.fn();
    const task = makeTask({ blockedBy: [{ id: 'design', title: 'Design', status: 'OPEN' }], blockedByCount: 1, openBlockerCount: 1 });
    render(<TaskDependencies task={task} statuses={STATUSES} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole('button', { name: 'Remove blocker: Design' }));

    await waitFor(() => expect(tasksApi.removeDependency).toHaveBeenCalledWith('build', 'design'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('the picker searches the server, hides this task and its current blockers, and adds the choice', async () => {
    vi.mocked(tasksApi.getAll).mockResolvedValue(
      axiosOk({
        data: [
          makeTask({ id: 'build', title: 'Build' }),
          makeTask({ id: 'design', title: 'Design' }),
          makeTask({ id: 'legal', title: 'Legal' }),
        ],
      } as never)
    );
    vi.mocked(tasksApi.addDependency).mockResolvedValue(axiosOk({ data: makeTask() }));
    const task = makeTask({ blockedBy: [{ id: 'design', title: 'Design', status: 'OPEN' }], blockedByCount: 1, openBlockerCount: 1 });
    render(<TaskDependencies task={task} statuses={STATUSES} onChanged={vi.fn()} />);

    const box = screen.getByPlaceholderText('Search a task this one waits on…');
    await userEvent.type(box, 'le');

    await waitFor(() => expect(tasksApi.getAll).toHaveBeenCalledWith(expect.objectContaining({ search: 'le', limit: '10' })));
    const option = await screen.findByRole('option', { name: 'Legal' });
    expect(screen.queryByRole('option', { name: 'Build' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Design' })).toBeNull();

    await userEvent.click(option);
    await waitFor(() => expect(tasksApi.addDependency).toHaveBeenCalledWith('build', 'legal'));
  });
});

describe('TaskProgressTags — Blocked', () => {
  it('shows a Blocked tag only while a blocker is open', () => {
    const { rerender } = render(<TaskProgressTags task={makeTask({ blockedByCount: 2, openBlockerCount: 1 })} />);
    expect(screen.getByText('Blocked')).toBeInTheDocument();

    rerender(<TaskProgressTags task={makeTask({ blockedByCount: 2, openBlockerCount: 0 })} />);
    expect(screen.queryByText('Blocked')).toBeNull();
  });
});
