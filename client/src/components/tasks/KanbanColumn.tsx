import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { KanbanCard } from './KanbanCard';
import type { Task, TaskStatus } from '../../types/task';

const statusLabels: Record<TaskStatus, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
};

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onCardClick: (task: Task) => void;
}

export function KanbanColumn({ status, tasks, onCardClick }: KanbanColumnProps) {
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
        <h4>{statusLabels[status]}</h4>
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
