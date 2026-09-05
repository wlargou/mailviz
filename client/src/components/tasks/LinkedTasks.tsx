import { useCallback, useEffect, useState } from 'react';
import { Button, SkeletonText, Tag } from '@carbon/react';
import { Launch } from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { tasksApi } from '../../api/tasks';
import { useTaskChanges } from '../../hooks/useTaskChanges';
import { TaskStatusTag } from '../shared/TaskStatusTag';
import { PriorityBadge } from '../shared/PriorityBadge';
import { EmptyState } from '../shared/EmptyState';
import { decodeEntities } from '../../utils/text';
import type { Task, TaskLinkType } from '../../types/task';

interface LinkedTasksProps {
  entityType: TaskLinkType;
  entityId: string;
  /** Reported to the host so a tab label can carry the count. */
  onCount?: (n: number) => void;
  /** `sm` for a block inside a panel; `md` for a page tab. */
  size?: 'sm' | 'md';
}

/**
 * The tasks attached to one contact, deal or event — the other side of the
 * panel's "Linked to". Read-only here: a task is opened on the Tasks page,
 * which is where it is edited.
 */
export function LinkedTasks({ entityType, entityId, onCount, size = 'md' }: LinkedTasksProps) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[] | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: res } = await tasksApi.getLinkedTo(entityType, entityId);
      setTasks(res.data);
      onCount?.(res.data.length);
    } catch {
      setTasks([]);
    }
  }, [entityType, entityId, onCount]);

  useEffect(() => {
    setTasks(null);
    void load();
  }, [load]);
  useTaskChanges(useCallback(() => { void load(); }, [load]));

  if (tasks === null) return <SkeletonText paragraph lineCount={3} />;
  if (tasks.length === 0) {
    return <EmptyState size={size} title="No tasks" description={`Tasks linked to this ${entityType} will appear here.`} />;
  }

  return (
    <ul className="linked-tasks">
      {tasks.map((task) => (
        <li key={task.id} className="linked-tasks__row">
          <div className="linked-tasks__main">
            <span className="linked-tasks__title">{decodeEntities(task.title)}</span>
            <span className="linked-tasks__meta">
              <TaskStatusTag status={task.status} />
              <PriorityBadge priority={task.priority} />
              {task.dueDate && <Tag size="sm" type="cool-gray">Due {format(new Date(task.dueDate), 'MMM d')}</Tag>}
            </span>
          </div>
          <Button
            kind="ghost"
            size="sm"
            hasIconOnly
            renderIcon={Launch}
            iconDescription="Open in Tasks"
            onClick={() => navigate(`/tasks?task=${task.id}`)}
          />
        </li>
      ))}
    </ul>
  );
}
