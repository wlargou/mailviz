import { TaskComplete } from '@carbon/icons-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}

export function EmptyState({ title, description, icon }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        {icon || <TaskComplete size={20} />}
      </div>
      <h4>{title}</h4>
      {description && <p>{description}</p>}
    </div>
  );
}
