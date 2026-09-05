import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { tasksApi } from '../../api/tasks';
import { useAuthStore } from '../../store/authStore';
import { useUIStore } from '../../store/uiStore';
import { TaskTime, formatMinutes } from './TaskTime';
import type { Task, TaskTimeEntry } from '../../types/task';

/**
 * The Time section: the timer buttons, the manual log, and who may delete.
 *
 * The one-timer rule is the server's; what the section owns is showing the
 * server's message when a second start is refused, and sending a log with
 * the minutes the user typed.
 */

vi.mock('../../api/tasks', () => ({
  tasksApi: { startTimer: vi.fn(), stopTimer: vi.fn(), logTime: vi.fn(), deleteTimeEntry: vi.fn() },
}));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Brief',
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
    userId: 'owner',
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

const entry = (overrides: Partial<TaskTimeEntry> = {}): TaskTimeEntry => ({
  id: 'e1',
  taskId: 't1',
  userId: 'me',
  startedAt: '2026-09-05T09:00:00.000Z',
  endedAt: '2026-09-05T09:30:00.000Z',
  minutes: 30,
  note: null,
  createdAt: '',
  user: { id: 'me', name: 'Walid', email: 'w@example.com', avatarUrl: null },
  ...overrides,
});

describe('formatMinutes', () => {
  it('reads as hours and minutes', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(90)).toBe('1h 30m');
  });
});

describe('TaskTime', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'me', name: 'Walid', email: 'w@example.com', avatarUrl: null, timezone: null } as never });
    useUIStore.setState({ notifications: [] } as never);
    vi.mocked(tasksApi.startTimer).mockReset();
    vi.mocked(tasksApi.stopTimer).mockReset();
    vi.mocked(tasksApi.logTime).mockReset();
    vi.mocked(tasksApi.deleteTimeEntry).mockReset();
  });

  it('starts a timer, and shows the server\'s message when another is running', async () => {
    vi.mocked(tasksApi.startTimer).mockRejectedValue({
      response: { status: 409, data: { error: { code: 'TIMER_RUNNING', message: 'A timer is already running on “Other”' } } },
    });
    const onChanged = vi.fn();
    render(<TaskTime task={makeTask()} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole('button', { name: 'Start timer' }));

    await waitFor(() => expect(tasksApi.startTimer).toHaveBeenCalledWith('t1'));
    expect(onChanged).not.toHaveBeenCalled();
    const shown = useUIStore.getState().notifications as Array<{ title: string; subtitle?: string }>;
    expect(shown[0]).toMatchObject({ title: 'Another timer is running', subtitle: 'A timer is already running on “Other”' });
  });

  it('shows the running timer with a Stop button and stops it', async () => {
    vi.mocked(tasksApi.stopTimer).mockResolvedValue(axiosOk({ data: entry() }));
    const onChanged = vi.fn();
    const running = entry({ id: 'r', endedAt: null, minutes: 0, startedAt: new Date(Date.now() - 65_000).toISOString() });
    render(<TaskTime task={makeTask({ runningEntry: running, timeEntries: [running] })} onChanged={onChanged} />);

    expect(screen.getByText(/^01:0\d$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(tasksApi.stopTimer).toHaveBeenCalledWith('t1'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('logs the minutes typed, with the note, and clears the line', async () => {
    vi.mocked(tasksApi.logTime).mockResolvedValue(axiosOk({ data: entry() }));
    render(<TaskTime task={makeTask()} onChanged={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText('Minutes'), '45');
    await userEvent.type(screen.getByPlaceholderText('What was it for? (optional)'), 'Call with Sam{Enter}');

    await waitFor(() => expect(tasksApi.logTime).toHaveBeenCalledWith('t1', { minutes: 45, note: 'Call with Sam' }));
    expect((screen.getByPlaceholderText('What was it for? (optional)') as HTMLInputElement).value).toBe('');
  });

  it('shows the total against the estimate, and lets the logger or the owner delete', async () => {
    vi.mocked(tasksApi.deleteTimeEntry).mockResolvedValue(axiosOk(undefined));
    const mine = entry({ id: 'mine', minutes: 30 });
    const theirs = entry({ id: 'theirs', userId: 'sam', minutes: 60, user: { id: 'sam', name: 'Sam', email: 's@example.com', avatarUrl: null } });
    render(<TaskTime task={makeTask({ trackedMinutes: 90, estimatedMinutes: 60, timeEntries: [mine, theirs] })} onChanged={vi.fn()} />);

    expect(screen.getByText('1h 30m tracked · 1h estimated')).toBeInTheDocument();
    expect(screen.getByText('30m over the estimate')).toBeInTheDocument();
    // I am not the owner: only my own entry has a delete control.
    expect(screen.getByRole('button', { name: 'Delete 30m entry' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete 1h entry' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Delete 30m entry' }));
    await waitFor(() => expect(tasksApi.deleteTimeEntry).toHaveBeenCalledWith('t1', 'mine'));
  });
});
