import { Tag } from '@carbon/react';

const defaultStatusConfig: Record<string, { label: string; type: string }> = {
  TODO: { label: 'To Do', type: 'blue' },
  IN_PROGRESS: { label: 'In Progress', type: 'teal' },
  DONE: { label: 'Done', type: 'green' },
};

interface TaskStatusTagProps {
  status: string;
}

export function TaskStatusTag({ status }: TaskStatusTagProps) {
  const config = defaultStatusConfig[status];
  if (config) {
    return (
      <Tag type={config.type as any} size="sm">
        {config.label}
      </Tag>
    );
  }
  // For dynamic custom statuses, show the name formatted
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Tag type="purple" size="sm">
      {label}
    </Tag>
  );
}
