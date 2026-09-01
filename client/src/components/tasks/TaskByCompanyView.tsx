import { useEffect, useState } from 'react';
import { Accordion, AccordionItem, SkeletonText, Tag, Toggle } from '@carbon/react';
import { format } from 'date-fns';
import { tasksApi, type TaskCompanyGroup } from '../../api/tasks';
import { useTaskStore } from '../../store/taskStore';
import { CompanyLogo } from '../shared/CompanyLogo';
import { EmptyState } from '../shared/EmptyState';
import { TaskStatusTag } from '../shared/TaskStatusTag';
import { PriorityBadge } from '../shared/PriorityBadge';
import { LabelTag } from '../shared/LabelTag';
import type { Task } from '../../types/task';

interface TaskByCompanyViewProps {
  onEdit: (task: Task) => void;
}

/**
 * Tasks grouped by the company they belong to.
 *
 * The grouping is free: tasks acquire a company automatically because
 * `convertToTask` copies the company off the email it was made from, and emails
 * are filed by sender domain. Nobody has to categorise anything.
 *
 * An Accordion because this is progressive disclosure over a list that is long
 * in companies and short in tasks per company. Carbon's own guidance flags the
 * risk — an accordion hides content, and a user may not notice what is behind a
 * closed row — so every number a reader needs is in the header: the task count
 * and, when there is one, the overdue count. Opening a section is then a choice
 * about detail, not a hunt for information that was concealed.
 *
 * The first group is open on mount for the same reason: an entirely collapsed
 * screen reads as empty.
 */
export function TaskByCompanyView({ onEdit }: TaskByCompanyViewProps) {
  const [groups, setGroups] = useState<TaskCompanyGroup[]>([]);
  const [meta, setMeta] = useState<{ totalTasks: number; companies: number; truncated: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [includeCompleted, setIncludeCompleted] = useState(false);

  /**
   * The same filters the List View uses, from the same store.
   *
   * Reading them here is what makes one filter bar serve all three tabs — this
   * view previously ignored them entirely, so narrowing to HIGH priority in the
   * list and switching tabs silently showed everything again.
   *
   * Subscribed field by field rather than taking the whole `filters` object,
   * because Zustand compares by reference: selecting the object re-runs the
   * effect on every unrelated store write, including the ones the list view
   * makes while paginating.
   */
  const search = useTaskStore((s) => s.filters.search);
  const status = useTaskStore((s) => s.filters.status);
  const priority = useTaskStore((s) => s.filters.priority);
  const labelId = useTaskStore((s) => s.filters.labelId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    tasksApi
      .getGroupedByCompany({ search, status, priority, labelId, includeCompleted })
      .then(({ data }) => {
        if (cancelled) return;
        setGroups(data.data);
        setMeta(data.meta);
      })
      // Without this the view sits on a skeleton for ever when the request
      // fails, which reads as "still loading" rather than "something broke".
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [search, status, priority, labelId, includeCompleted]);

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

  if (groups.length === 0) {
    return (
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
    );
  }

  return (
    <div className="task-by-company">
      <div className="task-by-company__controls">
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

      {meta && (
        <p className="task-by-company__summary">
          {meta.totalTasks} {meta.totalTasks === 1 ? 'task' : 'tasks'} across {meta.companies}{' '}
          {meta.companies === 1 ? 'company' : 'companies'}
          {meta.truncated && ' (showing the first 1,000)'}
        </p>
      )}

      <Accordion>
        {groups.map((group, index) => (
          <AccordionItem
            // The unassigned bucket has no company id, so it needs its own key.
            key={group.customer?.id ?? '__unassigned__'}
            open={index === 0}
            title={
              <span className="task-by-company__header">
                {group.customer ? (
                  <CompanyLogo
                    src={group.customer.logoUrl}
                    name={group.customer.name}
                    className="task-by-company__logo"
                  />
                ) : null}
                <span className="task-by-company__name">
                  {group.customer?.name ?? 'No company'}
                </span>
                <span className="task-by-company__counts">
                  <Tag type="cool-gray" size="sm">
                    {group.taskCount} {group.taskCount === 1 ? 'task' : 'tasks'}
                  </Tag>
                  {group.overdueCount > 0 && (
                    <Tag type="red" size="sm">
                      {group.overdueCount} overdue
                    </Tag>
                  )}
                </span>
              </span>
            }
          >
            <ul className="task-by-company__list">
              {group.tasks.map((task) => (
                <li key={task.id} className="task-by-company__task">
                  <button
                    type="button"
                    className="task-by-company__title"
                    onClick={() => onEdit(task)}
                  >
                    {task.title}
                  </button>
                  <span className="task-by-company__meta">
                    <TaskStatusTag status={task.status} />
                    <PriorityBadge priority={task.priority} />
                    {task.dueDate && (
                      <span
                        className={
                          new Date(task.dueDate) < new Date() && task.status !== 'DONE'
                            ? 'overdue-date'
                            : undefined
                        }
                      >
                        {format(new Date(task.dueDate), 'MMM d, yyyy')}
                      </span>
                    )}
                    {task.labels.map((label) => (
                      <LabelTag key={label.id} label={label} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
