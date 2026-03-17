import type { TaskPriority } from '../../types/task';

const priorityConfig: Record<TaskPriority, { label: string; color: string }> = {
  URGENT: { label: 'Urgent', color: 'var(--cds-support-error)' },
  HIGH: { label: 'High', color: 'var(--cds-support-warning)' },
  MEDIUM: { label: 'Medium', color: 'var(--cds-support-caution-minor)' },
  LOW: { label: 'Low', color: 'var(--cds-link-primary)' },
};

interface PriorityBadgeProps {
  priority: TaskPriority;
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  const config = priorityConfig[priority];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <span
        className="priority-dot"
        style={{ backgroundColor: config.color, width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }}
      />
      <span style={{ fontSize: '0.875rem' }}>{config.label}</span>
    </span>
  );
}
