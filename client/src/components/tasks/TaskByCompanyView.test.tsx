import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { tasksApi, type TaskCompanyGroup } from '../../api/tasks';
import { TaskByCompanyView } from './TaskByCompanyView';
import { useTaskStore } from '../../store/taskStore';
import type { Task } from '../../types/task';

/**
 * Tasks grouped by company.
 *
 * The failure this view has to avoid is losing work. It is an accordion, so
 * anything not in a header is hidden behind a click — which makes two things
 * load-bearing and worth testing rather than eyeballing:
 *
 *  - the counts in the header, because they are the only information a reader
 *    gets without expanding, and
 *  - the unassigned bucket, because a task with no company must still be
 *    reachable rather than quietly absent from a by-company view.
 */

vi.mock('../../api/tasks', () => ({
  tasksApi: { getGroupedByCompany: vi.fn() },
}));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2)}`,
    title: 'A task',
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
  };
}

function group(name: string | null, tasks: Task[], overdueCount = 0): TaskCompanyGroup {
  return {
    customer: name === null ? null : { id: `co-${name}`, name, domain: null, logoUrl: null },
    taskCount: tasks.length,
    overdueCount,
    tasks,
  };
}

function respond(groups: TaskCompanyGroup[], truncated = false) {
  vi.mocked(tasksApi.getGroupedByCompany).mockResolvedValue(
    axiosOk({
      data: groups,
      meta: {
        totalTasks: groups.reduce((n, g) => n + g.taskCount, 0),
        companies: groups.filter((g) => g.customer).length,
        truncated,
      },
    })
  );
}

/** Captured before any test mutates it; setState(_, true) replaces actions too. */
const initialTaskState = useTaskStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState(initialTaskState, true);
});

describe('TaskByCompanyView', () => {
  it('shows each company with its task count in the header', async () => {
    respond([
      group('Acme', [makeTask({ title: 'acme one' }), makeTask({ title: 'acme two' })]),
      group('Globex', [makeTask({ title: 'globex one' })]),
    ]);

    render(<TaskByCompanyView onEdit={vi.fn()} />);

    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
    // The count is the only thing a collapsed section tells you, so it has to
    // be right and it has to read naturally at 1.
    expect(screen.getByText('2 tasks')).toBeInTheDocument();
    expect(screen.getByText('1 task')).toBeInTheDocument();
  });

  it('surfaces an overdue count in the header, and omits it at zero', async () => {
    respond([
      group('Acme', [makeTask()], 3),
      group('Globex', [makeTask()], 0),
    ]);

    render(<TaskByCompanyView onEdit={vi.fn()} />);

    expect(await screen.findByText('3 overdue')).toBeInTheDocument();
    // A "0 overdue" tag on every healthy company is noise that makes the real
    // ones harder to spot.
    expect(screen.queryByText('0 overdue')).toBeNull();
  });

  it('labels the company-less bucket rather than dropping those tasks', async () => {
    // The bug this guards: a by-company view that only renders groups with a
    // company silently loses every task that has none.
    respond([group('Acme', [makeTask()]), group(null, [makeTask({ title: 'orphan' })])]);

    render(<TaskByCompanyView onEdit={vi.fn()} />);

    expect(await screen.findByText('No company')).toBeInTheDocument();
  });

  it('summarises the totals above the list', async () => {
    respond([group('Acme', [makeTask(), makeTask()]), group('Globex', [makeTask()])]);

    render(<TaskByCompanyView onEdit={vi.fn()} />);

    expect(await screen.findByText(/3 tasks across 2 companies/)).toBeInTheDocument();
  });

  it('says so when the server truncated the result', async () => {
    // Silent truncation would make the summary a lie.
    respond([group('Acme', [makeTask()])], true);

    render(<TaskByCompanyView onEdit={vi.fn()} />);

    expect(await screen.findByText(/showing the first 1,000/)).toBeInTheDocument();
  });

  it('opens the first group so the screen is not entirely collapsed', async () => {
    respond([
      group('Acme', [makeTask({ title: 'visible on mount' })]),
      group('Globex', [makeTask({ title: 'behind a click' })]),
    ]);

    render(<TaskByCompanyView onEdit={vi.fn()} />);

    // Carbon renders collapsed content in the DOM, so visibility is the check
    // that distinguishes open from closed.
    const first = await screen.findByText('visible on mount');
    expect(first).toBeVisible();
  });

  it('hands the whole task back when a title is activated', async () => {
    const onEdit = vi.fn();
    const target = makeTask({ title: 'open me' });
    respond([group('Acme', [target])]);

    render(<TaskByCompanyView onEdit={onEdit} />);
    await userEvent.click(await screen.findByRole('button', { name: 'open me' }));

    // The whole object, not just an id — TasksPage looks nothing up.
    expect(onEdit).toHaveBeenCalledWith(target);
  });

  it('exposes task titles as real buttons, reachable by keyboard', async () => {
    respond([group('Acme', [makeTask({ title: 'keyboard reachable' })])]);

    render(<TaskByCompanyView onEdit={vi.fn()} />);

    // A clickable div would satisfy the click test above and fail this one.
    expect(await screen.findByRole('button', { name: 'keyboard reachable' })).toBeInTheDocument();
  });

  it('shows an empty state rather than a bare screen when there are no tasks', async () => {
    respond([]);

    render(<TaskByCompanyView onEdit={vi.fn()} />);

    expect(await screen.findByText(/No tasks yet/)).toBeInTheDocument();
  });

  it('reports a failed request instead of showing the skeleton for ever', async () => {
    vi.mocked(tasksApi.getGroupedByCompany).mockRejectedValue(new Error('500'));

    render(<TaskByCompanyView onEdit={vi.fn()} />);

    // Leaving the skeleton up reads as "still loading" and the user waits.
    await waitFor(() => expect(screen.getByText(/Could not load tasks/)).toBeInTheDocument());
  });
});


describe('TaskByCompanyView — shared filters', () => {
  it('sends the List View filters to the server', async () => {
    // Before this, narrowing to HIGH priority in the list and switching tabs
    // silently showed everything again — two filter worlds in one page.
    respond([group('Acme', [makeTask()])]);
    useTaskStore.setState({
      filters: { ...initialTaskState.filters, search: 'renewal', priority: 'HIGH' },
    });

    render(<TaskByCompanyView onEdit={vi.fn()} />);
    await screen.findByText('Acme');

    expect(tasksApi.getGroupedByCompany).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'renewal', priority: 'HIGH' })
    );
  });

  it('refetches when a filter changes', async () => {
    respond([group('Acme', [makeTask()])]);
    render(<TaskByCompanyView onEdit={vi.fn()} />);
    await screen.findByText('Acme');
    expect(tasksApi.getGroupedByCompany).toHaveBeenCalledTimes(1);

    useTaskStore.setState({ filters: { ...initialTaskState.filters, search: 'new term' } });

    await waitFor(() => expect(tasksApi.getGroupedByCompany).toHaveBeenCalledTimes(2));
    expect(tasksApi.getGroupedByCompany).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'new term' })
    );
  });

  it('hides completed by default and asks for them when toggled', async () => {
    respond([group('Acme', [makeTask()])]);
    render(<TaskByCompanyView onEdit={vi.fn()} />);
    await screen.findByText('Acme');

    // Default: the flag is falsy, so counts mean outstanding work.
    expect(tasksApi.getGroupedByCompany).toHaveBeenCalledWith(
      expect.objectContaining({ includeCompleted: false })
    );

    await userEvent.click(screen.getByRole('switch'));

    await waitFor(() =>
      expect(tasksApi.getGroupedByCompany).toHaveBeenLastCalledWith(
        expect.objectContaining({ includeCompleted: true })
      )
    );
  });

  it('says no MATCH rather than no tasks when a filter is active', async () => {
    // "No tasks yet" under an active filter reads as an empty account.
    respond([]);
    useTaskStore.setState({ filters: { ...initialTaskState.filters, search: 'nothing matches' } });

    render(<TaskByCompanyView onEdit={vi.fn()} />);

    expect(await screen.findByText(/No tasks match these filters/)).toBeInTheDocument();
    expect(screen.queryByText(/No tasks yet/)).toBeNull();
  });
});
