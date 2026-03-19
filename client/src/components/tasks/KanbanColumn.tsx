import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { KanbanCard } from './KanbanCard';
import type { Task } from '../../types/task';

interface KanbanColumnProps {
  status: string;
  label: string;
  color: string;
  tasks: Task[];
  onCardClick: (task: Task) => void;
}

export function KanbanColumn({ status, label, color, tasks, onCardClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      className="kanban-column"
      ref={setNodeRef}
      style={{
        backgroundColor: isOver ? 'var(--cds-layer-02)' : undefined,
      }}
    >
      <div className="kanban-column-header">
        <span className="kanban-column-header__indicator" style={{ backgroundColor: color }} />
        <h4>{label}</h4>
        <span className="column-count">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="kanban-cards">
          {tasks.map((task) => (
            <KanbanCard key={task.id} task={task} onClick={onCardClick} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
