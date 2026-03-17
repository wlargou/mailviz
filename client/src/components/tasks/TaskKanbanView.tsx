import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { ClickableTile } from '@carbon/react';
import { KanbanColumn } from './KanbanColumn';
import { tasksApi } from '../../api/tasks';
import { useUIStore } from '../../store/uiStore';
import type { Task, TaskStatus, ReorderItem } from '../../types/task';

interface TaskKanbanViewProps {
  onCardClick: (task: Task) => void;
}

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE'];

export function TaskKanbanView({ onCardClick }: TaskKanbanViewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const addNotification = useUIStore((s) => s.addNotification);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const fetchKanbanTasks = useCallback(async () => {
    setLoading(true);
    try {
      const { data: response } = await tasksApi.getAll({
        limit: '200',
        sortBy: 'position',
        sortOrder: 'asc',
      });
      setTasks(response.data);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load kanban' });
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => {
    fetchKanbanTasks();
  }, [fetchKanbanTasks]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = { TODO: [], IN_PROGRESS: [], DONE: [] };
    tasks.forEach((t) => grouped[t.status].push(t));
    return grouped;
  }, [tasks]);

  const findTaskStatus = (taskId: string): TaskStatus | undefined => {
    return tasks.find((t) => t.id === taskId)?.status;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task || null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeStatus = findTaskStatus(activeId);
    // Determine target status: if over a column, use column id; otherwise use the task's status
    const overStatus = STATUSES.includes(overId as TaskStatus)
      ? (overId as TaskStatus)
      : findTaskStatus(overId);

    if (!activeStatus || !overStatus || activeStatus === overStatus) return;

    setTasks((prev) =>
      prev.map((t) => (t.id === activeId ? { ...t, status: overStatus } : t))
    );
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const activeTask = tasks.find((t) => t.id === activeId);

    if (!activeTask) return;

    const targetStatus = STATUSES.includes(overId as TaskStatus)
      ? (overId as TaskStatus)
      : (tasks.find((t) => t.id === overId)?.status || activeTask.status);

    const columnTasks = tasks.filter((t) => t.status === targetStatus);

    // If dropping on another task in the same column, reorder
    if (activeId !== overId && !STATUSES.includes(overId as TaskStatus)) {
      const oldIndex = columnTasks.findIndex((t) => t.id === activeId);
      const newIndex = columnTasks.findIndex((t) => t.id === overId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(columnTasks, oldIndex, newIndex);
        const reorderItems: ReorderItem[] = reordered.map((t, i) => ({
          id: t.id,
          status: targetStatus,
          position: (i + 1) * 1000,
        }));

        // Optimistic update
        setTasks((prev) => {
          const others = prev.filter((t) => t.status !== targetStatus);
          return [
            ...others,
            ...reordered.map((t, i) => ({ ...t, position: (i + 1) * 1000 })),
          ];
        });

        try {
          await tasksApi.reorder(reorderItems);
        } catch {
          addNotification({ kind: 'error', title: 'Failed to reorder' });
          fetchKanbanTasks();
        }
        return;
      }
    }

    // Moving to a new column
    if (activeTask.status !== targetStatus || STATUSES.includes(overId as TaskStatus)) {
      const updatedColumnTasks = tasks.filter(
        (t) => t.status === targetStatus && t.id !== activeId
      );
      updatedColumnTasks.push({ ...activeTask, status: targetStatus });

      const reorderItems: ReorderItem[] = updatedColumnTasks.map((t, i) => ({
        id: t.id,
        status: targetStatus,
        position: (i + 1) * 1000,
      }));

      try {
        await tasksApi.reorder(reorderItems);
      } catch {
        addNotification({ kind: 'error', title: 'Failed to move task' });
        fetchKanbanTasks();
      }
    }
  };

  if (loading) {
    return (
      <div className="kanban-board">
        {STATUSES.map((status) => (
          <div key={status} className="kanban-column" style={{ opacity: 0.5 }}>
            <div className="kanban-column-header">
              <h4>{status.replace('_', ' ')}</h4>
            </div>
            <div className="kanban-cards" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban-board">
        {STATUSES.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={tasksByStatus[status]}
            onCardClick={onCardClick}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask && (
          <ClickableTile className={`kanban-card kanban-card--${activeTask.priority.toLowerCase()}`}>
            <div className="card-title">{activeTask.title}</div>
          </ClickableTile>
        )}
      </DragOverlay>
    </DndContext>
  );
}
