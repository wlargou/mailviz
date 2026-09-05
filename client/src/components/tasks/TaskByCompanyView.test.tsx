import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
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
    recurrence: null,
    recurrenceNextId: null,
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

/** One response body. Split out of `respond` so a test can queue two of them. */
function payload(groups: TaskCompanyGroup[], truncated = false) {
  return axiosOk({
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
  });
}

function respond(groups: TaskCompanyGroup[], truncated = false) {
  vi.mocked(tasksApi.getGroupedByCompany).mockResolvedValue(payload(groups, truncated));
}

function renderView(props: { onEdit: (taskId: string) => void }) {
  return render(
    <MemoryRouter>
      <TaskByCompanyView
        labels={[]}
        onDelete={vi.fn()}
        onCreateNew={vi.fn()}
        {...props}
      />
    </MemoryRouter>
  );
}

/**
 * Ensure a company section is open.
 *
 * The leading company opens itself on mount, so a bare click on
 * `/Expand Acme/` finds nothing when Acme happens to lead — and *collapses* it
 * if the matcher is loosened to catch both labels. Asserting on the label is
 * the point: it is the same control either way, and this reads its state
 * rather than assuming an order the fixtures are free to change.
 */
async function openCompany(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  const control = await screen.findByRole('button', { name: new RegExp(`(Expand|Collapse) ${name.source}`) });
  if (control.getAttribute('aria-expanded') !== 'true') await user.click(control);
}

/** Captured before any test mutates it; setState(_, true) replaces actions too. */
const initialTaskState = useTaskStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call history but NOT a queue of mockResolvedValueOnce
  // values. A test that queues two responses and consumes one would otherwise
  // hand its leftover to whichever test runs next, which is both a flake and a
  // way for a broken component to look fine.
  vi.mocked(tasksApi.getGroupedByCompany).mockReset();
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

    // "3 overdue" appears twice on purpose — once as this company's row tag and
    // once as the global filter chip — so each assertion has to say which.
    // `pressed` picks the chip, because only it is a toggle.
    expect(await screen.findByRole('button', { name: /3 overdue/, pressed: false })).toBeInTheDocument();
    // And the company's own row carries it as a tag, not a button.
    const acmeRow = screen.getByText('Acme').closest('tr');
    expect(acmeRow?.textContent).toContain('3 overdue');

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

    const user = userEvent.setup();
    renderView({ onEdit: vi.fn() });

    expect(await screen.findByText('visible on mount')).toBeVisible();

    // And only the first. Every company section rendering open is the same
    // failure seen from the other side — the screen becomes one flat list and
    // the grouping stops meaning anything.
    expect(screen.queryByText('behind a click')).not.toBeInTheDocument();

    await openCompany(user, /Globex/);
    expect(screen.getByText('behind a click')).toBeVisible();
  });

  it('hands back the task id, not the row it was holding', async () => {
    // This assertion used to be the opposite, and the old contract was the bug:
    // a view passing its own copy upward is how the edit panel came to re-seed
    // stale values and save them back over newer ones. It also handed over the
    // wrong SHAPE — this endpoint includes `mailToTask`, the list endpoint does
    // not, so what the panel received depended on which tab you opened it from.
    // The panel fetches by id now, so an id is all a view may pass.
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const target = makeTask({ title: 'open me' });
    respond([group('Acme', [target])]);

    renderView({ onEdit });
    await openCompany(user, /Acme/);
    await user.click(screen.getByRole('button', { name: /Actions for open me/ }));
    await user.click(await screen.findByText('Edit task'));

    expect(onEdit).toHaveBeenCalledWith(target.id);
  });

  it('exposes every task row as a labelled expand control', async () => {
    // The row is the control now. It still has to be reachable and named, or
    // the second level of the hierarchy is mouse-only.
    respond([group('Acme', [makeTask({ title: 'keyboard reachable' })])]);
    renderView({ onEdit: vi.fn() });

    expect(await screen.findByRole('button', { name: /Expand keyboard reachable/ })).toBeInTheDocument();
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
describe('TaskByCompanyView — staying current', () => {
  it('reloads when a task is written anywhere in the app', async () => {
    // The reported bug: edit a task, get "Task updated", and the row underneath
    // still shows the old values until the page is reloaded. This view keeps
    // its own copy of the rows — it reads a different endpoint than the store —
    // and Carbon keeps inactive tab panels mounted, so nothing ever remounted
    // it either.
    //
    // Asserting the new text, not just a second call, is what stops this being
    // vacuous: a component that refetches and then discards the result would
    // satisfy a call count on its own.
    vi.mocked(tasksApi.getGroupedByCompany)
      .mockResolvedValueOnce(payload([group('Acme', [makeTask({ title: 'Old title' })])]))
      .mockResolvedValueOnce(payload([group('Acme', [makeTask({ title: 'Renew contract' })])]));

    renderView({ onEdit: vi.fn() });

    expect(await screen.findByText('Old title')).toBeInTheDocument();
    expect(tasksApi.getGroupedByCompany).toHaveBeenCalledTimes(1);

    act(() => { useTaskStore.getState().taskChanged(); });

    expect(await screen.findByText('Renew contract')).toBeInTheDocument();
    expect(screen.queryByText('Old title')).not.toBeInTheDocument();
  });

  it('does not reload on mount, when nothing has changed yet', async () => {
    // The subscription seeds itself with the current version precisely so a
    // mount does not duplicate the fetch the view already makes. Without that,
    // every view would issue two requests on every page load.
    respond([group('Acme', [makeTask({ title: 'Only once' })])]);
    renderView({ onEdit: vi.fn() });

    expect(await screen.findByText('Only once')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(tasksApi.getGroupedByCompany).toHaveBeenCalledTimes(1);
  });
});

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

  it('starts every row collapsed', async () => {
    // Both halves are load-bearing. Opening a company used to render every one
    // of its task panels at once while each toggle still reported itself
    // collapsed, so `aria-expanded` alone passed straight through the bug —
    // the detail content has to be absent, not merely announced as hidden.
    const user = userEvent.setup();
    respond([group('Acme', [withEmail()])]);
    renderView({ onEdit: vi.fn() });

    await openCompany(user, /Acme/);
    expect(screen.getByRole('button', { name: /Expand Renewal/ }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Morpheus license renewal terms/)).not.toBeInTheDocument();
  });

  it('reveals the description and the source email when expanded', async () => {
    const user = userEvent.setup();
    respond([group('Acme', [withEmail()])]);
    renderView({ onEdit: vi.fn() });

    await openCompany(user, /Acme/);
    await openCompany(user, /Renewal/);

    expect(screen.getByText(/Morpheus license renewal/)).toBeInTheDocument();
    expect(screen.getByText(/Ilham Bennani/)).toBeInTheDocument();
  });

  it('reports its expansion state so it can be read without sight', async () => {
    const user = userEvent.setup();
    respond([group('Acme', [withEmail()])]);
    renderView({ onEdit: vi.fn() });

    await openCompany(user, /Acme/);
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

    await openCompany(user, /Acme/);
    await user.click(screen.getByRole('button', { name: /Actions for Renewal/ }));
    await user.click(await screen.findByText('Open email'));

    expect(navigate).toHaveBeenCalledWith('/mail?thread=thread-9');
  });

  it('disables Open email for a task that came from nowhere', async () => {
    // Greyed rather than hidden: the absence of a source email is information
    // about the task, and a menu whose items change shape is harder to learn.
    const user = userEvent.setup();
    respond([group('Acme', [makeTask({ title: 'Manual task' })])]);
    renderView({ onEdit: vi.fn() });

    await openCompany(user, /Acme/);
    await user.click(screen.getByRole('button', { name: /Actions for Manual task/ }));

    const item = (await screen.findByText('Open email')).closest('button');
    expect(item).toBeDisabled();
  });

  it('marks a task done using the account’s own terminal status', async () => {
    // Not the literal name DONE — statuses are user-defined, and the view reads
    // which one is terminal rather than assuming.
    const user = userEvent.setup();
    const target = withEmail({ id: 'task-9' });
    respond([group('Acme', [target])]);
    vi.mocked(tasksApi.update).mockResolvedValue({ data: { data: target } } as never);
    renderView({ onEdit: vi.fn() });

    await openCompany(user, /Acme/);
    await user.click(screen.getByRole('button', { name: /Actions for Renewal/ }));
    await user.click(await screen.findByText('Mark as done'));

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

    // Sort lives in the filter flyout now, beside the other filters — the same
    // place the List View keeps them.
    await user.click(screen.getByRole('button', { name: /^Filter$/ }));
    await user.click(await screen.findByRole('combobox', { name: /sort by/i }));
    // `option`, not text: "Company" is now also a column header, so matching on
    // the string alone finds two things.
    await user.click(await screen.findByRole('option', { name: 'Company' }));

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

/**
 * The toolbar, which is the List View's toolbar.
 *
 * The two tabs should read as one component in different shapes, so search,
 * the filter flyout and the New Task button come from the same Carbon
 * primitives and sit in the same place. Sort moved inside the flyout with the
 * other filters rather than floating beside the table.
 */
describe('TaskByCompanyView — toolbar', () => {
  it('offers a New Task button that reaches the page', async () => {
    // Previously this tab had no way to create anything: you had to go back to
    // List View to add a task to a company you were looking at.
    const user = userEvent.setup();
    const onCreateNew = vi.fn();
    respond([group('Acme', [makeTask()])]);
    render(
      <MemoryRouter>
        <TaskByCompanyView labels={[]} onEdit={vi.fn()} onDelete={vi.fn()} onCreateNew={onCreateNew} />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole('button', { name: /new task/i }));

    expect(onCreateNew).toHaveBeenCalled();
  });

  it('keeps sort and filters together in the flyout', async () => {
    const user = userEvent.setup();
    respond([group('Acme', [makeTask()])]);
    renderView({ onEdit: vi.fn() });
    await screen.findByText('Acme');

    await user.click(screen.getByRole('button', { name: /^Filter$/ }));

    expect(await screen.findByRole('combobox', { name: /sort by/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /priority/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /label/i })).toBeInTheDocument();
  });

  it('drives the shared search filter, so the tabs agree', async () => {
    // The store is what List View reads, so typing here narrows both.
    const user = userEvent.setup();
    respond([group('Acme', [makeTask()])]);
    renderView({ onEdit: vi.fn() });
    await screen.findByText('Acme');

    await user.type(screen.getByRole('searchbox'), 'renewal');

    // Asserted on the shared store rather than the request: the store is what
    // makes the two tabs agree, and it settles synchronously where the refetch
    // is debounced behind a render.
    await waitFor(() => expect(useTaskStore.getState().filters.search).toBe('renewal'));
  });
});

describe('TaskByCompanyView — row actions', () => {
  it('offers delete from the row menu', async () => {
    // The design puts every row action behind the three dots; delete was not
    // reachable from this tab at all before.
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const target = makeTask({ title: 'Doomed' });
    respond([group('Acme', [target])]);
    render(
      <MemoryRouter>
        <TaskByCompanyView labels={[]} onEdit={vi.fn()} onDelete={onDelete} onCreateNew={vi.fn()} />
      </MemoryRouter>
    );

    await openCompany(user, /Acme/);
    await user.click(screen.getByRole('button', { name: /Actions for Doomed/ }));
    await user.click(await screen.findByText('Delete task'));

    expect(onDelete).toHaveBeenCalledWith(target);
  });

  it("names each row’s menu after its task", async () => {
    // Two menus called "Options" is what Carbon gives you by default, and it
    // makes the rows indistinguishable to anyone not looking at the screen.
    respond([group('Acme', [makeTask({ title: 'First' }), makeTask({ title: 'Second' })])]);
    const user = userEvent.setup();
    renderView({ onEdit: vi.fn() });

    await openCompany(user, /Acme/);

    expect(screen.getByRole('button', { name: /Actions for First/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Actions for Second/ })).toBeInTheDocument();
  });
});
