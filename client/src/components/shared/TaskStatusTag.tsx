import { Tag } from '@carbon/react';
import type { TaskStatus } from '../../types/task';

const statusConfig: Record<TaskStatus, { label: string; type: string }> = {
  TODO: { label: 'To Do', type: 'blue' },
  IN_PROGRESS: { label: 'In Progress', type: 'teal' },
  DONE: { label: 'Done', type: 'green' },
};

interface TaskStatusTagProps {
  status: TaskStatus;
}

export function TaskStatusTag({ status }: TaskStatusTagProps) {
  const config = statusConfig[status];
  return (
    <Tag type={config.type as any} size="sm">
      {config.label}
    </Tag>
  );
}
