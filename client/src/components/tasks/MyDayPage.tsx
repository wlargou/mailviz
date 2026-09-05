import { useCallback, useEffect, useState } from 'react';
import { ActionableNotification, Button, SkeletonText, Tag } from '@carbon/react';
import { Add } from '@carbon/icons-react';
import { format, isToday } from 'date-fns';
import { tasksApi } from '../../api/tasks';
import { taskStatusesApi } from '../../api/taskStatuses';
import { labelsApi } from '../../api/labels';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import { useTaskChanges } from '../../hooks/useTaskChanges';
import { PriorityBadge } from '../shared/PriorityBadge';
import { EmptyState } from '../shared/EmptyState';
import { TaskProgressTags } from './TaskProgressTags';
import { TaskDetailModal } from './TaskDetailModal';
import { TaskCreateModal } from './TaskCreateModal';
import { decodeEntities } from '../../utils/text';
import { apiErrorMessage } from '../../utils/apiError';
import type { Label, MyDay, Task, TaskStatusConfig } from '../../types/task';

type BucketKey = keyof MyDay;

const BUCKETS: Array<{ key: BucketKey; title: string; tone: 'red' | 'blue' | 'teal' | 'cool-gray'; empty: string }> = [
  { key: 'overdue', title: 'Overdue', tone: 'red', empty: 'Nothing overdue.' },
  { key: 'dueToday', title: 'Due today', tone: 'blue', empty: 'Nothing due today.' },
  { key: 'startingToday', title: 'Starting today', tone: 'teal', empty: 'Nothing starts today.' },
  { key: 'upcoming', title: 'Coming up this week', tone: 'cool-gray', empty: 'A quiet week ahead.' },
];

/**
 * What to do today.
 *
 * The dashboard answers "how much": counts and tiles. This answers "what
 * next": the tasks themselves, in four buckets the server computed in the
 * user's own timezone, most urgent first. Each row can be finished in place
 * — the checkbox moves it to the account's first terminal status, and a
 * blocked task says so instead — or opened in the panel.
 */
export function MyDayPage() {
  const addNotification = useUIStore((s) => s.addNotification);
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [day, setDay] = useState<MyDay | null>(null);
  const [failed, setFailed] = useState(false);
  const [statuses, setStatuses] = useState<TaskStatusConfig[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: res } = await tasksApi.getMyDay();
      setDay(res.data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    taskStatusesApi.getAll().then(({ data: res }) => setStatuses(res.data)).catch(() => {});
    labelsApi.getAll().then(({ data: res }) => setLabels(res.data)).catch(() => {});
  }, [load]);

  useTaskChanges(useCallback(() => { void load(); }, [load]));

  const doneStatus = statuses.find((s) => s.isTerminal)?.name ?? null;

  const finish = async (task: Task) => {
    if (!doneStatus) return;
    try {
      await tasksApi.update(task.id, { status: doneStatus });
      addNotification({ kind: 'success', title: `“${decodeEntities(task.title)}” done` });
      taskChanged();
    } catch (err) {
      addNotification({ kind: 'error', title: 'Could not finish the task', subtitle: apiErrorMessage(err, '') });
    }
  };

  const total = day ? day.overdue.length + day.dueToday.length + day.startingToday.length : 0;

  return (
    <div className="my-day">
      <div className="page-header">
        <div className="page-header__info">
          <h1>My Day</h1>
          <p className="page-header__subtitle">{format(new Date(), 'EEEE, MMMM d')}</p>
        </div>
        <Button renderIcon={Add} onClick={() => setCreateOpen(true)}>
          New Task
        </Button>
      </div>

      {failed && (
        <ActionableNotification
          inline
          kind="error"
          lowContrast
          hideCloseButton
          title="Could not load your day"
          subtitle="Showing nothing rather than something stale."
          actionButtonLabel="Try again"
          onActionButtonClick={() => void load()}
        />
      )}

      {!day && !failed && <SkeletonText paragraph lineCount={8} />}

      {day && total === 0 && day.upcoming.length === 0 && (
        <EmptyState title="Nothing on your plate today" description="No overdue, due or starting tasks. Enjoy it." />
      )}

      {day && (
        <div className="my-day__buckets">
          {BUCKETS.map((bucket) => {
            const tasks = day[bucket.key];
            if (tasks.length === 0 && bucket.key === 'upcoming' && total === 0) return null;
            return (
              <section key={bucket.key} className="my-day__bucket" aria-labelledby={`my-day-${bucket.key}`}>
                <h2 id={`my-day-${bucket.key}`} className="my-day__bucket-title">
                  {bucket.title}
                  <Tag size="sm" type={tasks.length > 0 ? bucket.tone : 'cool-gray'}>{tasks.length}</Tag>
                </h2>
                {tasks.length === 0 ? (
                  <p className="my-day__empty">{bucket.empty}</p>
                ) : (
                  <ul className="my-day__list">
                    {tasks.map((task) => {
                      const label = decodeEntities(task.title);
                      const date = bucket.key === 'startingToday' ? task.startDate : task.dueDate;
                      return (
                        <li key={task.id} className="my-day__row">
                          <input
                            type="checkbox"
                            className="my-day__check"
                            checked={false}
                            disabled={!doneStatus}
                            aria-label={`Mark done: ${label}`}
                            title={doneStatus ? undefined : 'No status is marked as finished. Set one in Settings.'}
                            onChange={() => void finish(task)}
                          />
                          <button type="button" className="my-day__title" onClick={() => setEditTaskId(task.id)}>
                            {label}
                          </button>
                          <span className="my-day__meta">
                            {task.customer && <span className="my-day__company">{task.customer.name}</span>}
                            <PriorityBadge priority={task.priority} />
                            {date && (
                              <span className={`my-day__date${bucket.key === 'overdue' ? ' overdue-date' : ''}`}>
                                {isToday(new Date(date)) ? format(new Date(date), 'HH:mm') === '00:00' ? 'Today' : format(new Date(date), 'HH:mm') : format(new Date(date), 'MMM d')}
                              </span>
                            )}
                            <TaskProgressTags task={task} />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <TaskDetailModal
        taskId={editTaskId}
        open={!!editTaskId}
        onClose={() => setEditTaskId(null)}
        onUpdated={() => setEditTaskId(null)}
        onOpenTask={setEditTaskId}
        labels={labels}
      />
      <TaskCreateModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => setCreateOpen(false)} labels={labels} />
    </div>
  );
}
