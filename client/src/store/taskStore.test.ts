import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { tasksApi } from '../api/tasks';
import { useTaskStore } from './taskStore';
import type { Task, TaskSummary } from '../types/task';
import type { ApiResponse } from '../types/api';

/**
 * The task list store.
 *
 * The list is paginated and sorted *on the server*, so this store's real output
 * is the query string it builds. Anything it gets wrong there is invisible in
 * the store and very visible on screen: a filter that keeps `page=3` shows an
 * empty grid, a cleared dropdown that sends `status=''` matches nothing, and a
 * sort that never reaches the API sorts only the twenty rows already fetched —
 * a lie about the rows the user cannot see.
 */

vi.mock('../api/tasks', () => ({
  tasksApi: {
    getAll: vi.fn(),
    getSummary: vi.fn(),
  },
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
    id: 'task-1',
    title: 'Follow up with Acme',
    description: null,
    status: 'TODO',
    priority: 'MEDIUM',
    dueDate: null,
    position: 0,
    customerId: null,
    assignedToId: null,
    assignedTo: null,
    estimatedMinutes: null,
    userId: 'user-alice',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    labels: [],
    customer: null,
    parentId: null,
    parent: null,
    subtaskCount: 0,
    subtaskDoneCount: 0,
    checklistCount: 0,
    checklistDoneCount: 0,
    ...overrides,
  };
}

const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };

function mockTasks(tasks: Task[], metaOverride = meta) {
  vi.mocked(tasksApi.getAll).mockResolvedValue(
    axiosOk<ApiResponse<Task[]>>({ data: tasks, meta: metaOverride })
  );
}

/** The params of the most recent GET /tasks. */
function lastParams(): Record<string, string> {
  const calls = vi.mocked(tasksApi.getAll).mock.calls;
  const params = calls[calls.length - 1][0];
  if (!params) throw new Error('getAll was called without params');
  return params;
}

/** Captured before any test mutates it; `setState(_, true)` replaces actions too. */
const initialState = useTaskStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState(initialState, true);
});

describe('taskStore', () => {
  it('starts on page 1 with the newest-first default sort', () => {
    const state = useTaskStore.getState();

    expect(state.tasks).toEqual([]);
    expect(state.summary).toBeNull();
    expect(state.meta).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.currentPage).toBe(1);
    expect(state.pageSize).toBe(20);
    // sortBy/sortOrder are not optional — they are always sent, so the server
    // never has to guess and the first page is deterministic.
    expect(state.filters).toEqual({ sortBy: 'createdAt', sortOrder: 'desc' });
  });

  it('sends pagination and sort on every fetch and stores the page meta', async () => {
    const task = makeTask();
    mockTasks([task]);

    await useTaskStore.getState().fetchTasks();

    expect(lastParams()).toEqual({
      page: '1',
      limit: '20',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(useTaskStore.getState().tasks).toEqual([task]);
    // Without meta the pagination control has no total and cannot render the
    // page count.
    expect(useTaskStore.getState().meta).toEqual(meta);
  });

  it('forwards every active filter to the API', async () => {
    mockTasks([]);
    const { setFilter } = useTaskStore.getState();

    setFilter('status', 'IN_PROGRESS');
    setFilter('priority', 'HIGH');
    setFilter('search', 'acme');
    setFilter('labelId', 'label-1');
    setFilter('ownership', 'shared');

    await useTaskStore.getState().fetchTasks();

    expect(lastParams()).toMatchObject({
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      search: 'acme',
      labelId: 'label-1',
      ownership: 'shared',
    });
  });

  it('resets to page 1 whenever a filter changes', async () => {
    mockTasks([]);
    useTaskStore.setState({ currentPage: 3 });

    useTaskStore.getState().setFilter('search', 'acme');

    expect(useTaskStore.getState().currentPage).toBe(1);

    await useTaskStore.getState().fetchTasks();
    // Filtering narrows the result set, so page 3 of the old set usually does
    // not exist in the new one: the user types a search and gets an empty grid
    // with no indication why.
    expect(lastParams().page).toBe('1');
  });

  it('sends a changed sort to the server, from page 1', async () => {
    mockTasks([]);
    useTaskStore.setState({ currentPage: 4 });

    useTaskStore.getState().setFilter('sortBy', 'dueDate');
    useTaskStore.getState().setFilter('sortOrder', 'asc');
    await useTaskStore.getState().fetchTasks();

    // Sorting is server-side across ALL tasks. If sortBy/sortOrder never reach
    // the query, the table reorders only the current page — which looks sorted
    // and is wrong.
    expect(lastParams()).toMatchObject({ sortBy: 'dueDate', sortOrder: 'asc', page: '1' });
  });

  it('drops a filter that is cleared to an empty string', async () => {
    mockTasks([]);
    const { setFilter } = useTaskStore.getState();
    setFilter('status', 'DONE');

    setFilter('status', '');

    expect(useTaskStore.getState().filters.status).toBeUndefined();
    await useTaskStore.getState().fetchTasks();
    // Carbon's Dropdown hands back '' when cleared. Forwarding that as
    // `status=` asks the server for tasks whose status is the empty string —
    // always zero rows.
    expect(lastParams()).not.toHaveProperty('status');
  });

  it('translates the overdue filter into a dueBefore cutoff that excludes done tasks', async () => {
    mockTasks([]);

    // Bracket the call: the cutoff has to be *now*, not merely some moment in
    // the past. Bounded only from above, this passed against a store sending
    // `new Date(0)` — an overdue filter asking for tasks due before 1970, which
    // returns nothing and leaves the dashboard tile stuck at 0.
    const before = Date.now();
    useTaskStore.getState().setFilter('overdue', 'true');
    await useTaskStore.getState().fetchTasks();
    const after = Date.now();

    const params = lastParams();
    const cutoff = Date.parse(params.dueBefore);
    expect(Number.isNaN(cutoff)).toBe(false);
    expect(cutoff).toBeGreaterThanOrEqual(before);
    expect(cutoff).toBeLessThanOrEqual(after);
    // "Overdue" that counts completed tasks is just "past due date" — the
    // dashboard tile would keep counting work that is already finished.
    expect(params.statusNot).toBe('DONE');
  });

  it('does not send statusNot when the user also picked a status', async () => {
    mockTasks([]);
    const { setFilter } = useTaskStore.getState();

    setFilter('overdue', 'true');
    setFilter('status', 'DONE');
    await useTaskStore.getState().fetchTasks();

    const params = lastParams();
    expect(params.status).toBe('DONE');
    // status=DONE plus statusNot=DONE is a contradiction: the explicit choice
    // would silently return nothing.
    expect(params).not.toHaveProperty('statusNot');
  });

  it('turns the overdue flag off again when it is cleared', async () => {
    mockTasks([]);
    const { setFilter } = useTaskStore.getState();
    setFilter('overdue', 'true');

    setFilter('overdue', 'false');

    expect(useTaskStore.getState().filters.overdue).toBeUndefined();
    await useTaskStore.getState().fetchTasks();
    expect(lastParams()).not.toHaveProperty('dueBefore');
  });

  it('keeps the filters when only the page changes', async () => {
    mockTasks([]);
    useTaskStore.getState().setFilter('search', 'acme');

    useTaskStore.getState().setPage(3);
    await useTaskStore.getState().fetchTasks();

    // Paging is not a filter change: losing the search on page 2 would page
    // through a different result set than the one on screen.
    expect(lastParams()).toMatchObject({ page: '3', search: 'acme' });
  });

  it('returns to page 1 when the page size changes', async () => {
    mockTasks([]);
    useTaskStore.setState({ currentPage: 5 });

    useTaskStore.getState().setPageSize(100);
    await useTaskStore.getState().fetchTasks();

    // Page 5 of 20-per-page is past the end at 100-per-page — an empty grid.
    expect(lastParams()).toMatchObject({ page: '1', limit: '100' });
  });

  it('resetFilters restores the defaults and the first page', async () => {
    mockTasks([]);
    const { setFilter } = useTaskStore.getState();
    setFilter('status', 'DONE');
    setFilter('sortBy', 'title');
    useTaskStore.setState({ currentPage: 2 });

    useTaskStore.getState().resetFilters();

    expect(useTaskStore.getState().filters).toEqual({ sortBy: 'createdAt', sortOrder: 'desc' });
    expect(useTaskStore.getState().currentPage).toBe(1);
    await useTaskStore.getState().fetchTasks();
    // Clearing filters must also restore a usable sort; leaving sortBy
    // undefined drops it from the query and the order becomes whatever the
    // database felt like.
    expect(lastParams()).toMatchObject({ sortBy: 'createdAt', sortOrder: 'desc' });
  });

  it('keeps the rows on screen and stops loading when the fetch fails', async () => {
    const task = makeTask();
    mockTasks([task]);
    await useTaskStore.getState().fetchTasks();

    vi.mocked(tasksApi.getAll).mockRejectedValue(new Error('500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(useTaskStore.getState().fetchTasks()).resolves.toBeUndefined();

    // A failed refresh must not half-update: the previous page stays, and
    // loading must clear or the table keeps its skeleton forever.
    expect(useTaskStore.getState().tasks).toEqual([task]);
    expect(useTaskStore.getState().meta).toEqual(meta);
    expect(useTaskStore.getState().loading).toBe(false);
  });

  it('is loading while the fetch is in flight', async () => {
    let resolve!: (value: AxiosResponse<ApiResponse<Task[]>>) => void;
    vi.mocked(tasksApi.getAll).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );

    const pending = useTaskStore.getState().fetchTasks();
    expect(useTaskStore.getState().loading).toBe(true);

    resolve(axiosOk<ApiResponse<Task[]>>({ data: [], meta }));
    await pending;
    expect(useTaskStore.getState().loading).toBe(false);
  });

  it('stores the summary, and keeps the last good one when the request fails', async () => {
    const summary: TaskSummary = {
      total: 4,
      completed: 1,
      overdue: 2,
      inProgress: 1,
      byPriority: { HIGH: 2, MEDIUM: 2 },
    };
    vi.mocked(tasksApi.getSummary).mockResolvedValue(
      axiosOk<ApiResponse<TaskSummary>>({ data: summary })
    );
    await useTaskStore.getState().fetchSummary();
    expect(useTaskStore.getState().summary).toEqual(summary);

    vi.mocked(tasksApi.getSummary).mockRejectedValue(new Error('500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(useTaskStore.getState().fetchSummary()).resolves.toBeUndefined();

    // The dashboard tiles read straight off this object; blanking it to null on
    // a transient 500 makes the counters flash empty.
    expect(useTaskStore.getState().summary).toEqual(summary);
  });
});

describe('the task-change signal', () => {
  it('counts writes, not refetches', async () => {
    // The distinction is the whole design. Views that keep their own copy of
    // the list watch this counter, and "the store refetched" is the wrong
    // signal to give them: fetchTasks re-runs on paging and on every debounced
    // keystroke in the search box, so bumping here would make the two heaviest
    // queries in the page fire twice per keystroke.
    vi.mocked(tasksApi.getAll).mockResolvedValue(axiosOk({ data: [] as Task[] }));

    expect(useTaskStore.getState().tasksVersion).toBe(0);
    await useTaskStore.getState().fetchTasks();
    expect(useTaskStore.getState().tasksVersion).toBe(0);

    useTaskStore.getState().taskChanged();
    expect(useTaskStore.getState().tasksVersion).toBe(1);
  });

  it('keeps the status vocabulary on its own counter', async () => {
    // Adding a Kanban column must not make every view refetch its tasks, and a
    // task edit must not make them re-read the status list.
    useTaskStore.getState().statusChanged();

    expect(useTaskStore.getState().statusesVersion).toBe(1);
    expect(useTaskStore.getState().tasksVersion).toBe(0);
  });
});

