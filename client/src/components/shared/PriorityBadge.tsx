import type { TaskPriority } from '../../types/task';

/**
 * Colour AND shape, per Carbon's status-indicator pattern — priority must
 * not rest on colour alone.
 *
 * High used `support-warning` and Medium `support-caution-minor`, and in g100
 * both are yellow 30 (#f1c21b): the two were indistinguishable everywhere a
 * priority showed. High is now `support-caution-major` (orange), and the shape
 * separates them for anyone who cannot tell the hues apart.
 */
const PRIORITY_LABELS: Record<TaskPriority, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

interface PriorityBadgeProps {
  priority: TaskPriority;
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  return (
    <span className="priority-badge">
      <span className={`priority-dot priority-dot--${priority.toLowerCase()}`} aria-hidden="true" />
      <span className="priority-badge__label">{PRIORITY_LABELS[priority]}</span>
    </span>
  );
}
