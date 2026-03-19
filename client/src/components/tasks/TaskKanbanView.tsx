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
import { ClickableTile, Button, TextInput } from '@carbon/react';
import { Add, Close } from '@carbon/icons-react';
import { KanbanColumn } from './KanbanColumn';
import { tasksApi } from '../../api/tasks';
import { taskStatusesApi } from '../../api/taskStatuses';
import { useUIStore } from '../../store/uiStore';
import type { Task, TaskStatus, TaskStatusConfig, ReorderItem } from '../../types/task';

interface TaskKanbanViewProps {
  onCardClick: (task: Task) => void;
}

export function TaskKanbanView({ onCardClick }: TaskKanbanViewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [statuses, setStatuses] = useState<TaskStatusConfig[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingStatus, setAddingStatus] = useState(false);
  const [newStatusLabel, setNewStatusLabel] = useState('');
  const addNotification = useUIStore((s) => s.addNotification);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const fetchStatuses = useCallback(async () => {
    try {
      const { data: res } = await taskStatusesApi.getAll();
      setStatuses(res.data);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load statuses' });
    }
  }, [addNotification]);

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
    fetchStatuses();
    fetchKanbanTasks();
  }, [fetchStatuses, fetchKanbanTasks]);

  const statusNames = useMemo(() => statuses.map((s) => s.name), [statuses]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    for (const s of statuses) grouped[s.name] = [];
    tasks.forEach((t) => {
      if (grouped[t.status]) grouped[t.status].push(t);
      else {
        // Task has an unknown status — put it in the first column
        const first = statuses[0]?.name;
        if (first && grouped[first]) grouped[first].push(t);
      }
    });
    return grouped;
  }, [tasks, statuses]);

  const findTaskStatus = (taskId: string): string | undefined => {
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
    const overStatus = statusNames.includes(overId)
      ? overId
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

    const targetStatus = statusNames.includes(overId)
      ? overId
      : (tasks.find((t) => t.id === overId)?.status || activeTask.status);

    const columnTasks = tasks.filter((t) => t.status === targetStatus);

    if (activeId !== overId && !statusNames.includes(overId)) {
      const oldIndex = columnTasks.findIndex((t) => t.id === activeId);
      const newIndex = columnTasks.findIndex((t) => t.id === overId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(columnTasks, oldIndex, newIndex);
        const reorderItems: ReorderItem[] = reordered.map((t, i) => ({
          id: t.id,
          status: targetStatus,
          position: (i + 1) * 1000,
        }));

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

    if (activeTask.status !== targetStatus || statusNames.includes(overId)) {
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

  const handleAddStatus = async () => {
    if (!newStatusLabel.trim()) return;
    try {
      await taskStatusesApi.create({ label: newStatusLabel.trim() });
      setNewStatusLabel('');
      setAddingStatus(false);
      fetchStatuses();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to create status' });
    }
  };

  if (loading) {
    return (
      <div className="kanban-board">
        {statuses.map((s) => (
          <div key={s.id} className="kanban-column" style={{ opacity: 0.5 }}>
            <div className="kanban-column-header">
              <h4>{s.label}</h4>
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
        {statuses.map((s) => (
          <KanbanColumn
            key={s.name}
            status={s.name}
            label={s.label}
            color={s.color}
            tasks={tasksByStatus[s.name] || []}
            onCardClick={onCardClick}
          />
        ))}

        {/* Add new status column */}
        <div className="kanban-column kanban-column--add">
          {addingStatus ? (
            <div className="kanban-add-form">
              <TextInput
                id="new-status-label"
                labelText=""
                placeholder="Status name..."
                size="sm"
                value={newStatusLabel}
                onChange={(e) => setNewStatusLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddStatus();
                  if (e.key === 'Escape') { setAddingStatus(false); setNewStatusLabel(''); }
                }}
                autoFocus
              />
              <div className="kanban-add-form__actions">
                <Button size="sm" kind="primary" onClick={handleAddStatus} disabled={!newStatusLabel.trim()}>
                  Add
                </Button>
                <Button size="sm" kind="ghost" renderIcon={Close} hasIconOnly iconDescription="Cancel"
                  onClick={() => { setAddingStatus(false); setNewStatusLabel(''); }}
                />
              </div>
            </div>
          ) : (
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Add}
              className="kanban-add-column-btn"
              onClick={() => setAddingStatus(true)}
            >
              Add status
            </Button>
          )}
        </div>
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
