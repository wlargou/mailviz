import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ClickableTile } from '@carbon/react';
import { format } from 'date-fns';
import { PriorityBadge } from '../shared/PriorityBadge';
import { LabelTag } from '../shared/LabelTag';
import type { Task } from '../../types/task';

interface KanbanCardProps {
  task: Task;
  onClick: (task: Task) => void;
}

export function KanbanCard({ task, onClick }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'DONE';

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ClickableTile
        className={`kanban-card kanban-card--${task.priority.toLowerCase()} ${isDragging ? 'dragging' : ''}`}
        onClick={() => onClick(task)}
      >
        <div className="card-title">{task.title}</div>
        <div className="card-meta">
          <PriorityBadge priority={task.priority} />
          {task.dueDate && (
            <span className={isOverdue ? 'overdue-date' : ''}>
              {format(new Date(task.dueDate), 'MMM d')}
            </span>
          )}
        </div>
        {task.customer && (
          <div className="card-meta" style={{ marginBottom: '0.25rem' }}>
            {task.customer.name}
          </div>
        )}
        {task.labels.length > 0 && (
          <div className="card-labels">
            {task.labels.map((label) => (
              <LabelTag key={label.id} label={label} />
            ))}
          </div>
        )}
      </ClickableTile>
    </div>
  );
}
