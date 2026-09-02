import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  tasksApi: { getGroupedByCompany: vi.fn(), update: vi.fn() },
}));

// The view reads the account's statuses to find out which one means "done" —
// there is no hard-coded DONE any more, so the mock has to supply one or the
// "Mark as done" action correctly hides itself.
vi.mock('../../api/taskStatuses', () => ({
  taskStatusesApi: {
    getAll: vi.fn().mockResolvedValue({
      data: { data: [
        { id: 's1', name: 'TODO', label: 'To do', color: '#4589ff', position: 0, isTerminal: false, createdAt: '' },
        { id: 's2', name: 'SHIPPED', label: 'Shipped', color: '#24a148', position: 1, isTerminal: true, createdAt: '' },
      ] },
    }),
  },
}));

const addNotification = vi.fn();
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: (s: { addNotification: typeof addNotification }) => unknown) =>
    selector({ addNotification }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
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

function group(
  name: string | null,
  tasks: Task[],
  overdueCount = 0,
  nextDueAt: string | null = null
): TaskCompanyGroup {
  return {
    customer: name === null ? null : { id: `co-${name}`, name, domain: null, logoUrl: null },
    taskCount: tasks.length,
    overdueCount,
    nextDueAt,
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
        overdueTasks: groups.reduce((n, g) => n + g.overdueCount, 0),
        urgentTasks: groups.reduce(
          (n, g) => n + g.tasks.filter((t) => t.priority === 'URGENT').length,
          0
        ),
      },
    })
  );
}

function renderView(props: { onEdit: (t: Task) => void }) {
  return render(
    <MemoryRouter>
      <TaskByCompanyView {...props} />
    </MemoryRouter>
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

    renderView({ onEdit: vi.fn() });

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

    renderView({ onEdit: vi.fn() });

    // "3 overdue" now appears twice on purpose — once as this company's header
    // tag and once as the global filter chip — so each assertion has to say
    // which. `pressed` picks the chip, because only it is a toggle; the header
    // is Carbon's accordion heading, which is also a button but has no pressed
    // state. Matching on the text alone finds both.
    expect(await screen.findByRole('button', { name: /3 overdue/, pressed: false })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { expanded: true, name: /Acme/ })
    ).toHaveAccessibleName(expect.stringContaining('3 overdue'));

    // A "0 overdue" tag on every healthy company is noise that makes the real
    // ones harder to spot.
    expect(screen.queryByText('0 overdue')).toBeNull();
  });

  it('labels the company-less bucket rather than dropping those tasks', async () => {
    // The bug this guards: a by-company view that only renders groups with a
    // company silently loses every task that has none.
    respond([group('Acme', [makeTask()]), group(null, [makeTask({ title: 'orphan' })])]);

    renderView({ onEdit: vi.fn() });

    expect(await screen.findByText('No company')).toBeInTheDocument();
  });

  it('summarises the totals above the list', async () => {
    respond([group('Acme', [makeTask(), makeTask()]), group('Globex', [makeTask()])]);

    renderView({ onEdit: vi.fn() });

    expect(await screen.findByText(/3 tasks across 2 companies/)).toBeInTheDocument();
  });

  it('says so when the server truncated the result', async () => {
    // Silent truncation would make the summary a lie.
    respond([group('Acme', [makeTask()])], true);

    renderView({ onEdit: vi.fn() });

    expect(await screen.findByText(/showing the first 1,000/)).toBeInTheDocument();
  });

  it('opens the first group so the screen is not entirely collapsed', async () => {
    respond([
      group('Acme', [makeTask({ title: 'visible on mount' })]),
      group('Globex', [makeTask({ title: 'behind a click' })]),
    ]);

    renderView({ onEdit: vi.fn() });

    // Carbon renders collapsed content in the DOM, so visibility is the check
    // that distinguishes open from closed.
    const first = await screen.findByText('visible on mount');
    expect(first).toBeVisible();
  });

  it('hands the whole task back when a title is activated', async () => {
    const onEdit = vi.fn();
    const target = makeTask({ title: 'open me' });
    respond([group('Acme', [target])]);

    renderView({ onEdit });
    await userEvent.click(await screen.findByRole('button', { name: 'open me' }));

    // The whole object, not just an id — TasksPage looks nothing up.
    expect(onEdit).toHaveBeenCalledWith(target);
  });

  it('exposes task titles as real buttons, reachable by keyboard', async () => {
    respond([group('Acme', [makeTask({ title: 'keyboard reachable' })])]);

    renderView({ onEdit: vi.fn() });

    // A clickable div would satisfy the click test above and fail this one.
    expect(await screen.findByRole('button', { name: 'keyboard reachable' })).toBeInTheDocument();
  });

  it('shows an empty state rather than a bare screen when there are no tasks', async () => {
    respond([]);

    renderView({ onEdit: vi.fn() });

    expect(await screen.findByText(/No tasks yet/)).toBeInTheDocument();
  });

  it('reports a failed request instead of showing the skeleton for ever', async () => {
    vi.mocked(tasksApi.getGroupedByCompany).mockRejectedValue(new Error('500'));

    renderView({ onEdit: vi.fn() });

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

    renderView({ onEdit: vi.fn() });
    await screen.findByText('Acme');

    expect(tasksApi.getGroupedByCompany).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'renewal', priority: 'HIGH' })
    );
  });

  it('refetches when a filter changes', async () => {
    respond([group('Acme', [makeTask()])]);
    renderView({ onEdit: vi.fn() });
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
    renderView({ onEdit: vi.fn() });
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

    renderView({ onEdit: vi.fn() });

    expect(await screen.findByText(/No tasks match these filters/)).toBeInTheDocument();
    expect(screen.queryByText(/No tasks yet/)).toBeNull();
  });
});

/**
 * What the redesign added: a per-task disclosure, the mail a task came from,
 * the filter chips, and sorting.
 *
 * The through-line is that a collapsed row should answer "does this need me"
 * without being opened, and the expanded one should answer "what is it" without
 * leaving the page. Each of these asserts one half of that.
 */
describe('TaskByCompanyView — the task row', () => {
  const withEmail = (overrides: Partial<Task> = {}) =>
    makeTask({
      title: 'Renewal',
      description: 'Morpheus license renewal terms forwarded for review.',
      mailToTask: {
        id: 'm1',
        conversionNote: null,
        email: {
          id: 'e1',
          subject: 'Contract & License',
          from: 'ilham@acme.test',
          fromName: 'Ilham Bennani',
          threadId: 'thread-9',
          receivedAt: '2026-08-24T09:00:00.000Z',
        },
      },
      ...overrides,
    } as Partial<Task>);

  it('keeps the detail hidden until the row is expanded', async () => {
    respond([group('Acme', [withEmail()])]);
    renderView({ onEdit: vi.fn() });

    await screen.findByText('Renewal');
    // The point of a disclosure: the description is not in the DOM at rest, so
    // a long one cannot push every other row down the page.
    expect(screen.queryByText(/Morpheus license renewal/)).toBeNull();
  });

  it('reveals the description and the source email when expanded', async () => {
    const user = userEvent.setup();
    respond([group('Acme', [withEmail()])]);
    renderView({ onEdit: vi.fn() });

    await user.click(await screen.findByRole('button', { name: /Expand Renewal/ }));

    expect(screen.getByText(/Morpheus license renewal/)).toBeInTheDocument();
    expect(screen.getByText(/Ilham Bennani/)).toBeInTheDocument();
  });

  it('reports its expansion state so it can be read without sight', async () => {
    const user = userEvent.setup();
    respond([group('Acme', [withEmail()])]);
    renderView({ onEdit: vi.fn() });

    const disclosure = await screen.findByRole('button', { name: /Expand Renewal/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    await user.click(disclosure);

    expect(await screen.findByRole('button', { name: /Collapse Renewal/ }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('links Open email to the thread the task came from', async () => {
    const user = userEvent.setup();
    respond([group('Acme', [withEmail()])]);
    renderView({ onEdit: vi.fn() });

    await user.click(await screen.findByRole('button', { name: /Expand Renewal/ }));
    await user.click(screen.getByRole('button', { name: 'Open email' }));

    expect(navigate).toHaveBeenCalledWith('/mail?thread=thread-9');
  });

  it('disables Open email for a task that came from nowhere', async () => {
    // Greyed rather than hidden: the absence of a source email is information
    // about the task, and a row whose actions change shape is harder to scan.
    const user = userEvent.setup();
    respond([group('Acme', [makeTask({ title: 'Manual task' })])]);
    renderView({ onEdit: vi.fn() });

    await user.click(await screen.findByRole('button', { name: /Expand Manual task/ }));

    expect(screen.getByRole('button', { name: 'Open email' })).toBeDisabled();
  });

  it('marks a task done using the account’s own terminal status', async () => {
    // Not the literal name DONE — statuses are user-defined, and the view reads
    // which one is terminal rather than assuming.
    const user = userEvent.setup();
    const target = withEmail({ id: 'task-9' });
    respond([group('Acme', [target])]);
    vi.mocked(tasksApi.update).mockResolvedValue({ data: { data: target } } as never);
    renderView({ onEdit: vi.fn() });

    await user.click(await screen.findByRole('button', { name: /Expand Renewal/ }));
    await user.click(screen.getByRole('button', { name: /Mark as done/ }));

    await waitFor(() => expect(tasksApi.update).toHaveBeenCalledWith('task-9', { status: 'SHIPPED' }));
  });
});

describe('TaskByCompanyView — chips and sorting', () => {
  it('narrows the list to overdue work when the chip is pressed', async () => {
    const user = userEvent.setup();
    const past = new Date(Date.now() - 86400000).toISOString();
    respond([
      group('Acme', [makeTask({ title: 'late one', dueDate: past })], 1),
      group('Globex', [makeTask({ title: 'on time' })]),
    ]);
    renderView({ onEdit: vi.fn() });

    await user.click(await screen.findByRole('button', { name: /1 overdue/, pressed: false }));

    expect(screen.getByText('late one')).toBeInTheDocument();
    // Globex has nothing overdue, so the whole company drops out rather than
    // showing as an empty section.
    expect(screen.queryByText('Globex')).toBeNull();
  });

  it('releases the filter when the active chip is pressed again', async () => {
    const user = userEvent.setup();
    const past = new Date(Date.now() - 86400000).toISOString();
    respond([
      group('Acme', [makeTask({ title: 'late one', dueDate: past })], 1),
      group('Globex', [makeTask({ title: 'on time' })]),
    ]);
    renderView({ onEdit: vi.fn() });

    const chip = await screen.findByRole('button', { name: /1 overdue/, pressed: false });
    await user.click(chip);
    await user.click(await screen.findByRole('button', { name: /1 overdue/, pressed: true }));

    expect(await screen.findByText('Globex')).toBeInTheDocument();
  });

  it('counts what is on screen once a chip narrows the list', async () => {
    /**
     * Caught in the browser, not by a test: with "2 overdue" pressed the
     * summary still read "4 tasks across 2 companies" and the company header
     * still said "3 tasks", both above two visible rows in one company. The
     * chips keep showing totals — they are the way back to the full set — but
     * the summary and the headers describe what is actually there.
     */
    const user = userEvent.setup();
    const past = new Date(Date.now() - 86400000).toISOString();
    respond([
      group('Acme', [
        makeTask({ title: 'late one', dueDate: past }),
        makeTask({ title: 'fine one' }),
      ], 1),
      group('Globex', [makeTask({ title: 'elsewhere' })]),
    ]);
    renderView({ onEdit: vi.fn() });

    expect(await screen.findByText(/3 tasks across 2 companies/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /1 overdue/, pressed: false }));

    expect(await screen.findByText(/1 task across 1 company/)).toBeInTheDocument();
    // The chip itself still reports the total, which is what makes it a way back.
    expect(screen.getByRole('button', { name: /3 tasks/ })).toBeInTheDocument();
  });

  it('hides a chip with nothing behind it', async () => {
    // A permanent "0 overdue" is furniture, and it makes the real ones harder
    // to spot.
    respond([group('Acme', [makeTask()])]);
    renderView({ onEdit: vi.fn() });

    await screen.findByText('Acme');
    expect(screen.queryByRole('button', { name: /overdue/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /urgent/ })).toBeNull();
  });

  it('asks the server to re-sort rather than reordering locally', async () => {
    // The server holds every group; sorting the page in the client would only
    // order what happens to be loaded.
    const user = userEvent.setup();
    respond([group('Acme', [makeTask()])]);
    renderView({ onEdit: vi.fn() });
    await screen.findByText('Acme');

    await user.click(screen.getByRole('combobox', { name: /sort/i }));
    await user.click(await screen.findByText('Company'));

    await waitFor(() =>
      expect(tasksApi.getGroupedByCompany).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'company' })
      )
    );
  });

  it('shows when the next work is due for a company with nothing overdue', async () => {
    respond([group('Acme', [makeTask()], 0, '2026-09-20T09:00:00.000Z')]);
    renderView({ onEdit: vi.fn() });

    expect(await screen.findByText(/Next due/)).toBeInTheDocument();
  });
});
