import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  DataTableSkeleton,
  Dropdown,
  OverflowMenu,
  OverflowMenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableExpandHeader,
  TableExpandRow,
  TableExpandedRow,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Tag,
  Toggle,
} from '@carbon/react';
import { Add, Email, WarningFilled } from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { format, isToday, isTomorrow } from 'date-fns';
import { tasksApi, type TaskCompanyGroup, type TaskCompanyMeta, type TaskGroupSort } from '../../api/tasks';
import { taskStatusesApi } from '../../api/taskStatuses';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import { CompanyLogo } from '../shared/CompanyLogo';
import { EmptyState } from '../shared/EmptyState';
import { TableFilterFlyout } from '../shared/TableFilterFlyout';
import { TaskStatusTag } from '../shared/TaskStatusTag';
import { PriorityBadge } from '../shared/PriorityBadge';
import { LabelTag } from '../shared/LabelTag';
import { toolbarSearchValue, type TableToolbarSearchChangeEvent } from '../../utils/carbonSearch';
import type { Label, Task } from '../../types/task';

interface TaskByCompanyViewProps {
  labels: Label[];
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onCreateNew: () => void;
}

/** Which subset of the returned tasks the chips are narrowing to. */
type Chip = 'all' | 'overdue' | 'urgent';

const SORT_ITEMS: Array<{ id: TaskGroupSort; text: string }> = [
  { id: 'urgency', text: 'Urgency' },
  { id: 'company', text: 'Company' },
  { id: 'taskCount', text: 'Task count' },
];

const PRIORITY_ITEMS = [
  { id: '', text: 'All Priorities' },
  { id: 'URGENT', text: 'Urgent' },
  { id: 'HIGH', text: 'High' },
  { id: 'MEDIUM', text: 'Medium' },
  { id: 'LOW', text: 'Low' },
];

/**
 * A due date as a person reads it.
 *
 * "Today" and "Tomorrow" rather than a date, because the column exists to
 * answer "is this urgent" at a glance and a reader should not have to compare
 * `Sep 2` against today's date to find out. The year appears only when it is
 * not this one.
 */
function dueLabel(iso: string): string {
  const date = new Date(iso);
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return format(date, sameYear ? 'MMM d' : 'MMM d, yyyy');
}

/**
 * Tasks grouped by the company they belong to.
 *
 * Built on the same Carbon table primitives as the List View — the same
 * `TableContainer` / `TableToolbar` / `TableExpandRow` — so the two tabs read
 * as one component with a different shape rather than two designs. The toolbar
 * carries what the List View's does: search, the shared filter flyout, and the
 * New Task button.
 *
 * The structure Carbon does NOT provide is the second level. Its expandable
 * variant expands one level, so the task rows are a nested table inside each
 * company's expanded row: companies expand to reveal tasks, and a task expands
 * in place to reveal its detail. Carbon's own guidance for the expanded section
 * — supplementary information, kept out of the row until asked for — is what
 * both levels are doing.
 *
 * `DataTable`'s render-prop wrapper is deliberately not used. It owns a flat
 * row model with its own sort and selection state, and neither survives being
 * given a hierarchy; sorting here is a server concern because the server holds
 * every group. The primitives give identical styling without pretending.
 */
export function TaskByCompanyView({ labels, onEdit, onDelete, onCreateNew }: TaskByCompanyViewProps) {
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);

  const [groups, setGroups] = useState<TaskCompanyGroup[]>([]);
  const [meta, setMeta] = useState<TaskCompanyMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [sort, setSort] = useState<TaskGroupSort>('urgency');
  const [chip, setChip] = useState<Chip>('all');
  const [openCompanies, setOpenCompanies] = useState<Set<string>>(new Set());
  const [openTasks, setOpenTasks] = useState<Set<string>>(new Set());
  const [terminalStatus, setTerminalStatus] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);

  const search = useTaskStore((s) => s.filters.search);
  const status = useTaskStore((s) => s.filters.status);
  const priority = useTaskStore((s) => s.filters.priority);
  const labelId = useTaskStore((s) => s.filters.labelId);
  const setFilter = useTaskStore((s) => s.setFilter);
  const resetFilters = useTaskStore((s) => s.resetFilters);

  /**
   * The search box is controlled locally and pushed to the shared store on a
   * debounce, exactly as the List View does it.
   *
   * There is deliberately NO effect syncing the store back into this state.
   * The first version had one, and it ate every keystroke after the first: the
   * store update re-rendered the input with a value one character behind what
   * had just been typed. One direction only.
   */
  const [localSearch, setLocalSearch] = useState(search ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Which status means "done" for this account.
   *
   * Read rather than assumed: statuses are user-defined rows and the name DONE
   * is not guaranteed to exist. With nothing marked terminal there is no such
   * thing as finishing a task here, and the action hides itself rather than
   * writing a status that means nothing.
   */
  useEffect(() => {
    taskStatusesApi
      .getAll()
      .then(({ data }) => setTerminalStatus(data.data.find((s) => s.isTerminal)?.name ?? null))
      .catch(() => setTerminalStatus(null));
  }, []);

  const load = useCallback(
    async (showSkeleton = true) => {
      if (showSkeleton) setLoading(true);
      setFailed(false);
      try {
        const { data } = await tasksApi.getGroupedByCompany({
          search, status, priority, labelId, includeCompleted, sort,
        });
        setGroups(data.data);
        setMeta(data.meta);
      } catch {
        setFailed(true);
      } finally {
        if (showSkeleton) setLoading(false);
      }
    },
    [search, status, priority, labelId, includeCompleted, sort]
  );

  useEffect(() => { void load(); }, [load]);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const isOverdue = useCallback(
    (task: Task) =>
      Boolean(task.dueDate) &&
      new Date(task.dueDate as string) < new Date() &&
      task.status !== terminalStatus,
    [terminalStatus]
  );

  /**
   * Chip filtering happens here, not on the server, so the count on the chip
   * and the rows in the list always describe the same set. Asking the server
   * again could return a different one between the two.
   */
  const visibleGroups = useMemo(() => {
    if (chip === 'all') return groups;
    return groups
      .map((g) => ({
        ...g,
        tasks: g.tasks.filter((t) => (chip === 'overdue' ? isOverdue(t) : t.priority === 'URGENT')),
      }))
      .filter((g) => g.tasks.length > 0);
  }, [groups, chip, isOverdue]);

  const shownTasks = visibleGroups.reduce((n, g) => n + g.tasks.length, 0);
  const shownCompanies = visibleGroups.filter((g) => g.customer).length;

  const markDone = async (task: Task) => {
    if (!terminalStatus) return;
    setBusyTask(task.id);
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        tasks: g.tasks.map((t) => (t.id === task.id ? { ...t, status: terminalStatus } : t)),
      }))
    );
    try {
      await tasksApi.update(task.id, { status: terminalStatus });
      addNotification({ kind: 'success', title: `“${task.title}” marked done` });
    } catch {
      addNotification({ kind: 'error', title: 'Could not update the task' });
    } finally {
      setBusyTask(null);
      await load(false);
    }
  };

  const openEmail = (task: Task) => {
    const threadId = task.mailToTask?.email.threadId;
    if (threadId) navigate(`/mail?thread=${encodeURIComponent(threadId)}`);
  };

  const handleSearchChange = useCallback(
    (e: TableToolbarSearchChangeEvent) => {
      const value = toolbarSearchValue(e);
      setLocalSearch(value);
      // Same 400ms as the List View: a refetch per keystroke against a grouped
      // query over every task is a lot of work to throw away.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setFilter('search', value || undefined), 400);
    },
    [setFilter]
  );

  const activeFilterCount = [status, priority, labelId].filter(Boolean).length;
  const filtered = Boolean(search || status || priority || labelId);

  const headers = [
    { key: 'name', header: 'Company' },
    { key: 'count', header: 'Tasks' },
    { key: 'due', header: '' },
  ];

  const toolbar = (
    <TableToolbar>
      <TableToolbarContent>
        <TableToolbarSearch
          placeholder="Search tasks or companies"
          value={localSearch}
          onChange={handleSearchChange}
          persistent
        />
        <TableFilterFlyout activeFilterCount={activeFilterCount} onReset={resetFilters}>
          <Dropdown
            id="by-company-sort"
            titleText="Sort by"
            label="Urgency"
            items={SORT_ITEMS}
            itemToString={(item: { id: TaskGroupSort; text: string } | null) => item?.text ?? ''}
            selectedItem={SORT_ITEMS.find((s) => s.id === sort) ?? SORT_ITEMS[0]}
            onChange={({ selectedItem }) => selectedItem && setSort(selectedItem.id)}
            size="sm"
          />
          <Dropdown
            id="by-company-priority"
            titleText="Priority"
            label="All Priorities"
            items={PRIORITY_ITEMS}
            itemToString={(item: { id: string; text: string } | null) => item?.text ?? ''}
            selectedItem={PRIORITY_ITEMS.find((p) => p.id === (priority || '')) ?? PRIORITY_ITEMS[0]}
            onChange={({ selectedItem }) => setFilter('priority', selectedItem?.id || undefined)}
            size="sm"
          />
          <Dropdown
            id="by-company-label"
            titleText="Label"
            label="All Labels"
            items={[{ id: '', text: 'All Labels' }, ...labels.map((l) => ({ id: l.id, text: l.name }))]}
            itemToString={(item: { id: string; text: string } | null) => item?.text ?? ''}
            selectedItem={
              [{ id: '', text: 'All Labels' }, ...labels.map((l) => ({ id: l.id, text: l.name }))]
                .find((l) => l.id === (labelId || '')) ?? { id: '', text: 'All Labels' }
            }
            onChange={({ selectedItem }) => setFilter('labelId', selectedItem?.id || undefined)}
            size="sm"
          />
          <Toggle
            id="by-company-completed"
            size="sm"
            labelText="Completed tasks"
            labelA="Hidden"
            labelB="Shown"
            toggled={includeCompleted}
            onToggle={setIncludeCompleted}
          />
        </TableFilterFlyout>
        <Button renderIcon={Add} onClick={onCreateNew}>
          New Task
        </Button>
      </TableToolbarContent>
    </TableToolbar>
  );

  if (loading) return <DataTableSkeleton headers={headers} rowCount={6} />;

  if (failed) {
    return (
      <EmptyState
        title="Could not load tasks"
        description="Something went wrong fetching the grouping. Reload to try again."
      />
    );
  }

  return (
    <div className="task-by-company">
      <TableContainer className="tasks-table">
        {toolbar}

        {groups.length === 0 ? (
          <EmptyState
            title={filtered ? 'No tasks match these filters' : 'No tasks yet'}
            description={
              filtered
                ? 'Try clearing the search or filters above.'
                : "Tasks created from an email are grouped here under that email's company."
            }
          />
        ) : (
          <>
            <div className="task-by-company__summary-row">
              <p className="task-by-company__summary">
                {shownTasks} {shownTasks === 1 ? 'task' : 'tasks'} across {shownCompanies}{' '}
                {shownCompanies === 1 ? 'company' : 'companies'}
                {meta?.truncated && ' (showing the first 1,000)'}
              </p>

              <div className="task-by-company__chips">
                {meta && (
                  <>
                    <button
                      type="button"
                      className={`task-by-company__chip${chip === 'all' ? ' task-by-company__chip--active' : ''}`}
                      aria-pressed={chip === 'all'}
                      onClick={() => setChip('all')}
                    >
                      {meta.totalTasks} {meta.totalTasks === 1 ? 'task' : 'tasks'}
                    </button>
                    {meta.overdueTasks > 0 && (
                      <button
                        type="button"
                        className={`task-by-company__chip task-by-company__chip--overdue${chip === 'overdue' ? ' task-by-company__chip--active' : ''}`}
                        aria-pressed={chip === 'overdue'}
                        onClick={() => setChip(chip === 'overdue' ? 'all' : 'overdue')}
                      >
                        {meta.overdueTasks} overdue
                      </button>
                    )}
                    {meta.urgentTasks > 0 && (
                      <button
                        type="button"
                        className={`task-by-company__chip task-by-company__chip--urgent${chip === 'urgent' ? ' task-by-company__chip--active' : ''}`}
                        aria-pressed={chip === 'urgent'}
                        onClick={() => setChip(chip === 'urgent' ? 'all' : 'urgent')}
                      >
                        {meta.urgentTasks} urgent
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            <Table className="task-by-company__table">
              <TableHead>
                <TableRow>
                  <TableExpandHeader aria-label="Expand company" />
                  {headers.map((h) => (
                    <TableHeader key={h.key} id={h.key}>{h.header}</TableHeader>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleGroups.map((group) => {
                  const key = group.customer?.id ?? '__unassigned__';
                  const companyOpen = openCompanies.has(key);
                  const name = group.customer?.name ?? 'No company';

                  return (
                    <>
                      <TableExpandRow
                        key={key}
                        isExpanded={companyOpen}
                        onExpand={() => setOpenCompanies((s) => toggle(s, key))}
                        aria-label={`${companyOpen ? 'Collapse' : 'Expand'} ${name}`}
                      >
                        <TableCell>
                          <span className="task-by-company__company">
                            <CompanyLogo
                              src={group.customer?.logoUrl}
                              name={name}
                              className="task-by-company__logo"
                            />
                            <span className="task-by-company__name">{name}</span>
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="task-by-company__counts">
                            <Tag type="cool-gray" size="sm">
                              {group.tasks.length} {group.tasks.length === 1 ? 'task' : 'tasks'}
                            </Tag>
                            {group.overdueCount > 0 && chip !== 'urgent' && (
                              <Tag type="red" size="sm">
                                <WarningFilled size={12} /> {group.overdueCount} overdue
                              </Tag>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="task-by-company__next-due-cell">
                          {group.overdueCount === 0 && group.nextDueAt
                            ? `Next due ${dueLabel(group.nextDueAt)}`
                            : ''}
                        </TableCell>
                      </TableExpandRow>

                      {/* The second level. Carbon expands one, so the tasks are
                          their own table inside the company's expanded row. */}
                      <TableExpandedRow colSpan={headers.length + 1} className="task-by-company__nested">
                        <Table className="task-by-company__tasks" size="sm">
                          <TableBody>
                            {group.tasks.map((task) => {
                              const taskOpen = openTasks.has(task.id);
                              const overdue = isOverdue(task);
                              const sourceEmail = task.mailToTask?.email ?? null;

                              return (
                                <>
                                  <TableExpandRow
                                    key={task.id}
                                    isExpanded={taskOpen}
                                    onExpand={() => setOpenTasks((s) => toggle(s, task.id))}
                                    aria-label={`${taskOpen ? 'Collapse' : 'Expand'} ${task.title}`}
                                    className={overdue ? 'task-by-company__task--overdue' : undefined}
                                  >
                                    <TableCell className="task-by-company__task-title">
                                      {task.title}
                                    </TableCell>
                                    <TableCell>
                                      {task.labels.map((label) => (
                                        <LabelTag key={label.id} label={label} />
                                      ))}
                                    </TableCell>
                                    <TableCell>
                                      {sourceEmail && (
                                        <Email
                                          size={16}
                                          className="task-by-company__mail-icon"
                                          aria-label="Created from an email"
                                        />
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      {task.dueDate ? (
                                        <span
                                          className={`task-by-company__due${overdue ? ' task-by-company__due--overdue' : ''}`}
                                        >
                                          {overdue && <WarningFilled size={12} />}{' '}
                                          {dueLabel(task.dueDate)}
                                        </span>
                                      ) : (
                                        <span className="task-by-company__due--none">—</span>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      <PriorityBadge priority={task.priority} />
                                    </TableCell>
                                    <TableCell>
                                      <TaskStatusTag status={task.status} />
                                    </TableCell>
                                    <TableCell className="task-by-company__actions-cell">
                                      {/* Row actions, as the design has them.
                                          An OverflowMenu rather than a row of
                                          icon buttons: the same three actions
                                          on every row is a menu, and it keeps
                                          the row scannable. */}
                                      {/*
                                        `iconDescription`, not `aria-label`.
                                        Both are typed, but v11 renders the
                                        former as the button's assistive text
                                        (defaulting to "Options") and drops the
                                        latter — so every row's menu would
                                        otherwise be called the same thing.
                                      */}
                                      <OverflowMenu
                                        size="sm"
                                        flipped
                                        iconDescription={`Actions for ${task.title}`}
                                      >
                                        {terminalStatus && task.status !== terminalStatus && (
                                          <OverflowMenuItem
                                            itemText="Mark as done"
                                            disabled={busyTask === task.id}
                                            onClick={() => void markDone(task)}
                                          />
                                        )}
                                        <OverflowMenuItem
                                          itemText="Open email"
                                          disabled={!sourceEmail?.threadId}
                                          onClick={() => openEmail(task)}
                                        />
                                        <OverflowMenuItem
                                          itemText="Edit task"
                                          onClick={() => onEdit(task)}
                                        />
                                        <OverflowMenuItem
                                          isDelete
                                          hasDivider
                                          itemText="Delete task"
                                          onClick={() => onDelete(task)}
                                        />
                                      </OverflowMenu>
                                    </TableCell>
                                  </TableExpandRow>

                                  <TableExpandedRow colSpan={8} className="task-by-company__detail-row">
                                    <div className="task-by-company__detail">
                                      {task.description && (
                                        <p className="task-by-company__description">{task.description}</p>
                                      )}
                                      <dl className="task-by-company__facts">
                                        {sourceEmail && (
                                          <div>
                                            <dt>From email</dt>
                                            <dd>
                                              {sourceEmail.fromName || sourceEmail.from} ·{' '}
                                              {dueLabel(sourceEmail.receivedAt)}
                                            </dd>
                                          </div>
                                        )}
                                        <div>
                                          <dt>Due</dt>
                                          <dd>
                                            {task.dueDate
                                              ? format(new Date(task.dueDate), 'MMM d, yyyy')
                                              : 'No due date'}
                                          </dd>
                                        </div>
                                        <div>
                                          <dt>Priority</dt>
                                          <dd><PriorityBadge priority={task.priority} /></dd>
                                        </div>
                                      </dl>
                                    </div>
                                  </TableExpandedRow>
                                </>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </TableExpandedRow>
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </TableContainer>
    </div>
  );
}
