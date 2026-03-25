import { TaskComplete } from '@carbon/icons-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        {icon || <TaskComplete size={20} />}
      </div>
      <h4>{title}</h4>
      {description && <p>{description}</p>}
      {action && <div style={{ marginTop: '1rem' }}>{action}</div>}
    </div>
  );
}
