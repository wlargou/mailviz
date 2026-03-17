import {
  StructuredListWrapper,
  StructuredListHead,
  StructuredListRow,
  StructuredListCell,
  StructuredListBody,
  SkeletonText,
} from '@carbon/react';
import { format } from 'date-fns';
import { TaskStatusTag } from '../shared/TaskStatusTag';
import { PriorityBadge } from '../shared/PriorityBadge';
import { EmptyState } from '../shared/EmptyState';
import type { Task } from '../../types/task';

interface RecentTasksListProps {
  tasks: Task[];
  loading: boolean;
}

export function RecentTasksList({ tasks, loading }: RecentTasksListProps) {
  if (loading) {
    return (
      <div>
        {[1, 2, 3].map((i) => (
          <SkeletonText key={i} paragraph lineCount={2} />
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return <EmptyState title="No tasks yet" description="Create your first task using the quick add form" />;
  }

  return (
    <div>
      <StructuredListWrapper>
        <StructuredListHead>
          <StructuredListRow head>
            <StructuredListCell head>Title</StructuredListCell>
            <StructuredListCell head>Status</StructuredListCell>
            <StructuredListCell head>Priority</StructuredListCell>
            <StructuredListCell head>Due Date</StructuredListCell>
          </StructuredListRow>
        </StructuredListHead>
        <StructuredListBody>
          {tasks.map((task) => (
            <StructuredListRow key={task.id}>
              <StructuredListCell>{task.title}</StructuredListCell>
              <StructuredListCell>
                <TaskStatusTag status={task.status} />
              </StructuredListCell>
              <StructuredListCell>
                <PriorityBadge priority={task.priority} />
              </StructuredListCell>
              <StructuredListCell>
                {task.dueDate ? (
                  <span
                    className={
                      new Date(task.dueDate) < new Date() && task.status !== 'DONE'
                        ? 'overdue-date'
                        : ''
                    }
                  >
                    {format(new Date(task.dueDate), 'MMM d, yyyy')}
                  </span>
                ) : (
                  <span style={{ color: 'var(--cds-text-secondary)' }}>No date</span>
                )}
              </StructuredListCell>
            </StructuredListRow>
          ))}
        </StructuredListBody>
      </StructuredListWrapper>
    </div>
  );
}
