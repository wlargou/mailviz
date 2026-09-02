import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionItem,
  Dropdown,
  Search,
  SkeletonText,
  Tag,
  Toggle,
} from '@carbon/react';
import { CheckmarkFilled, Email, WarningFilled } from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { format, isToday, isTomorrow } from 'date-fns';
import { tasksApi, type TaskCompanyGroup, type TaskCompanyMeta, type TaskGroupSort } from '../../api/tasks';
import { taskStatusesApi } from '../../api/taskStatuses';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import { CompanyLogo } from '../shared/CompanyLogo';
import { EmptyState } from '../shared/EmptyState';
import { TaskStatusTag } from '../shared/TaskStatusTag';
import { PriorityBadge } from '../shared/PriorityBadge';
import { LabelTag } from '../shared/LabelTag';
import type { Task } from '../../types/task';

interface TaskByCompanyViewProps {
  onEdit: (task: Task) => void;
}

/** Which subset of the returned tasks the chips are narrowing to. */
type Chip = 'all' | 'overdue' | 'urgent';

const SORT_ITEMS: Array<{ id: TaskGroupSort; label: string }> = [
  { id: 'urgency', label: 'Urgency' },
  { id: 'company', label: 'Company' },
  { id: 'taskCount', label: 'Task count' },
];

/**
 * A due date as a person reads it.
 *
 * "Today" and "Tomorrow" rather than a date, because the whole point of the
 * column is answering "is this urgent" at a glance and a reader should not have
 * to compare `Sep 2` against today's date to find out. The year appears only
 * when it is not this one — otherwise every row carries four characters that
 * are the same on all of them.
 */
function dueLabel(iso: string): string {
  const date = new Date(iso);
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return format(date, sameYear ? 'MMM d' : 'MMM d, yyyy');
}

export function TaskByCompanyView({ onEdit }: TaskByCompanyViewProps) {
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);

  const [groups, setGroups] = useState<TaskCompanyGroup[]>([]);
  const [meta, setMeta] = useState<TaskCompanyMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [sort, setSort] = useState<TaskGroupSort>('urgency');
  const [chip, setChip] = useState<Chip>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [terminalStatus, setTerminalStatus] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);

  /**
   * The same filters the List View uses, from the same store.
   *
   * Subscribed field by field rather than taking the whole `filters` object,
   * because Zustand compares by reference: selecting the object re-runs the
   * effect on every unrelated store write.
   */
  const search = useTaskStore((s) => s.filters.search);
  const status = useTaskStore((s) => s.filters.status);
  const priority = useTaskStore((s) => s.filters.priority);
  const labelId = useTaskStore((s) => s.filters.labelId);
  const setFilter = useTaskStore((s) => s.setFilter);

  /**
   * Which status means "done" for this account.
   *
   * Read rather than assumed: statuses are user-defined rows and the name DONE
   * is not guaranteed to exist. If nothing is marked terminal there is no such
   * thing as finishing a task here, and the action hides itself rather than
   * writing a status that means nothing.
   */
  useEffect(() => {
    taskStatusesApi
      .getAll()
      .then(({ data }) => setTerminalStatus(data.data.find((s) => s.isTerminal)?.name ?? null))
      .catch(() => setTerminalStatus(null));
  }, []);

  /**
   * One fetch, used by the filter effect and by the refresh after an edit.
   *
   * `showSkeleton` is false for the refresh: replacing the whole list with a
   * loading skeleton because one task was marked done throws away the reader's
   * place for a change they can already see.
   */
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
        // Without this the view sits on a skeleton for ever when the request
        // fails, which reads as "still loading" rather than "something broke".
        setFailed(true);
      } finally {
        if (showSkeleton) setLoading(false);
      }
    },
    [search, status, priority, labelId, includeCompleted, sort]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const toggleTask = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isOverdue = (task: Task) =>
    Boolean(task.dueDate) &&
    new Date(task.dueDate as string) < new Date() &&
    task.status !== terminalStatus;

  /**
   * Chip filtering happens here, not on the server.
   *
   * The counts come from the same response the rows do, so narrowing in the
   * client keeps the chip and the list describing the same set. Asking the
   * server again could return a different set between the two.
   */
  const visibleGroups = useMemo(() => {
    if (chip === 'all') return groups;
    return groups
      .map((g) => ({
        ...g,
        tasks: g.tasks.filter((t) => (chip === 'overdue' ? isOverdue(t) : t.priority === 'URGENT')),
      }))
      .filter((g) => g.tasks.length > 0);
  }, [groups, chip, terminalStatus]);

  /**
   * The summary counts what is on screen, not what was fetched.
   *
   * With a chip active the two differ — pressing "2 overdue" hides whole
   * companies — and a header reading "4 tasks across 2 companies" above two
   * rows in one company is simply wrong. The chips keep showing the totals,
   * because that is what they are for: they are the way back to the full set.
   */
  const shownTasks = visibleGroups.reduce((n, g) => n + g.tasks.length, 0);
  const shownCompanies = visibleGroups.filter((g) => g.customer).length;

  const markDone = async (task: Task) => {
    if (!terminalStatus) return;
    setBusyTask(task.id);
    // Optimistic: the row should settle under the cursor, and a reload puts it
    // back if the request failed.
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        tasks: g.tasks.map((t) => (t.id === task.id ? { ...t, status: terminalStatus } : t)),
      }))
    );
    try {
      await tasksApi.update(task.id, { status: terminalStatus });
      addNotification({ kind: 'success', title: `“${task.title}” marked done` });
      await load(false);
    } catch {
      addNotification({ kind: 'error', title: 'Could not update the task' });
      await load(false);
    } finally {
      setBusyTask(null);
    }
  };

  const openEmail = (task: Task) => {
    const threadId = task.mailToTask?.email.threadId;
    if (!threadId) return;
    navigate(`/mail?thread=${encodeURIComponent(threadId)}`);
  };

  if (loading) {
    return (
      <div style={{ padding: '1rem 0' }}>
        <SkeletonText paragraph lineCount={6} />
      </div>
    );
  }

  if (failed) {
    return (
      <EmptyState
        title="Could not load tasks"
        description="Something went wrong fetching the grouping. Reload to try again."
      />
    );
  }

  const filtered = Boolean(search || status || priority || labelId);

  return (
    <div className="task-by-company">
      <div className="task-by-company__toolbar">
        <Search
          size="lg"
          labelText="Search tasks or companies"
          placeholder="Search tasks or companies"
          value={search ?? ''}
          onChange={(e) => setFilter('search', e.target.value)}
          onClear={() => setFilter('search', '')}
        />
        <Dropdown
          id="task-by-company-sort"
          className="task-by-company__sort"
          size="lg"
          titleText="Sort"
          type="inline"
          label="Sort"
          items={SORT_ITEMS}
          itemToString={(item) => item?.label ?? ''}
          selectedItem={SORT_ITEMS.find((i) => i.id === sort) ?? SORT_ITEMS[0]}
          onChange={({ selectedItem }) => selectedItem && setSort(selectedItem.id)}
        />
      </div>

      {groups.length === 0 ? (
        <EmptyState
          // "No tasks yet" under an active filter is misleading — it reads as an
          // empty account rather than an empty result.
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
            {meta && (
              <p className="task-by-company__summary">
                {shownTasks} {shownTasks === 1 ? 'task' : 'tasks'} across {shownCompanies}{' '}
                {shownCompanies === 1 ? 'company' : 'companies'}
                {meta.truncated && ' (showing the first 1,000)'}
              </p>
            )}

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
                  {/* Only shown when there is something to show: a permanent
                      "0 overdue" is furniture, and it makes the real ones
                      harder to spot. */}
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
              <Toggle
                id="task-by-company-completed"
                size="sm"
                labelText=""
                labelA="Hide completed"
                labelB="Showing completed"
                toggled={includeCompleted}
                onToggle={setIncludeCompleted}
              />
            </div>
          </div>

          {visibleGroups.length === 0 ? (
            <EmptyState
              title="Nothing matches that filter"
              description="Clear the chip above to see every task again."
            />
          ) : (
            <Accordion>
              {visibleGroups.map((group, index) => (
                <AccordionItem
                  // The unassigned bucket has no company id, so it needs its own key.
                  key={group.customer?.id ?? '__unassigned__'}
                  open={index === 0}
                  title={
                    <span className="task-by-company__header">
                      <CompanyLogo
                        src={group.customer?.logoUrl}
                        name={group.customer?.name ?? 'No company'}
                        className="task-by-company__logo"
                      />
                      <span className="task-by-company__name">
                        {group.customer?.name ?? 'No company'}
                      </span>
                      <span className="task-by-company__counts">
                        {/* Counts the rows actually under this header. With a
                            chip active `group.taskCount` is the unfiltered
                            total, which would read "3 tasks" above two. */}
                        <Tag type="cool-gray" size="sm">
                          {group.tasks.length} {group.tasks.length === 1 ? 'task' : 'tasks'}
                        </Tag>
                        {group.overdueCount > 0 && chip !== 'urgent' && (
                          <Tag type="red" size="sm">
                            <WarningFilled size={12} /> {group.overdueCount} overdue
                          </Tag>
                        )}
                      </span>
                      {/* What a collapsed row says when nothing is overdue —
                          otherwise the right-hand side is blank and the row
                          tells you only how much work exists, not when it lands. */}
                      {group.overdueCount === 0 && group.nextDueAt && (
                        <span className="task-by-company__next-due">
                          Next due {dueLabel(group.nextDueAt)}
                        </span>
                      )}
                    </span>
                  }
                >
                  <ul className="task-by-company__list">
                    {group.tasks.map((task) => {
                      const open = expanded.has(task.id);
                      const overdue = isOverdue(task);
                      const sourceEmail = task.mailToTask?.email ?? null;

                      return (
                        <li
                          key={task.id}
                          className={`task-by-company__task${overdue ? ' task-by-company__task--overdue' : ''}`}
                        >
                          <div className="task-by-company__row">
                            <button
                              type="button"
                              className="task-by-company__disclosure"
                              aria-expanded={open}
                              aria-label={`${open ? 'Collapse' : 'Expand'} ${task.title}`}
                              onClick={() => toggleTask(task.id)}
                            >
                              <span aria-hidden="true">{open ? '⌄' : '›'}</span>
                            </button>

                            <button
                              type="button"
                              className="task-by-company__title"
                              onClick={() => onEdit(task)}
                            >
                              {task.title}
                            </button>

                            <span className="task-by-company__meta">
                              {task.labels.map((label) => (
                                <LabelTag key={label.id} label={label} />
                              ))}
                              {sourceEmail && (
                                <Email
                                  size={16}
                                  className="task-by-company__mail-icon"
                                  aria-label="Created from an email"
                                />
                              )}
                              {task.dueDate ? (
                                <span
                                  className={`task-by-company__due${overdue ? ' task-by-company__due--overdue' : ''}`}
                                >
                                  {overdue && <WarningFilled size={12} />} {dueLabel(task.dueDate)}
                                </span>
                              ) : (
                                <span className="task-by-company__due task-by-company__due--none">—</span>
                              )}
                              <PriorityBadge priority={task.priority} />
                              <TaskStatusTag status={task.status} />
                            </span>
                          </div>

                          {open && (
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
                                  <dd>
                                    <PriorityBadge priority={task.priority} />
                                  </dd>
                                </div>
                              </dl>

                              <div className="task-by-company__actions">
                                {terminalStatus && task.status !== terminalStatus && (
                                  <button
                                    type="button"
                                    className="task-by-company__action task-by-company__action--primary"
                                    disabled={busyTask === task.id}
                                    onClick={() => void markDone(task)}
                                  >
                                    <CheckmarkFilled size={16} /> Mark as done
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="task-by-company__action"
                                  // Disabled rather than hidden: the absence of
                                  // a source email is information about the
                                  // task, and a row whose actions change shape
                                  // is harder to scan than one that greys out.
                                  disabled={!sourceEmail?.threadId}
                                  onClick={() => openEmail(task)}
                                >
                                  Open email
                                </button>
                                <button
                                  type="button"
                                  className="task-by-company__action"
                                  onClick={() => onEdit(task)}
                                >
                                  Edit task
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </>
      )}
    </div>
  );
}
