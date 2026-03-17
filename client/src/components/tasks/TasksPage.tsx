import { useEffect, useState, useCallback } from 'react';
import { Button, Tabs, TabList, Tab, TabPanels, TabPanel } from '@carbon/react';
import { Add } from '@carbon/icons-react';
import { useSearchParams } from 'react-router-dom';
import { TaskFilters } from './TaskFilters';
import { TaskListView } from './TaskListView';
import { TaskKanbanView } from './TaskKanbanView';
import { TaskCreateModal } from './TaskCreateModal';
import { TaskDetailModal } from './TaskDetailModal';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import { labelsApi } from '../../api/labels';
import { tasksApi } from '../../api/tasks';
import type { Task, Label } from '../../types/task';

export function TasksPage() {
  const { tasks, loading, fetchTasks, setFilter } = useTaskStore();
  const addNotification = useUIStore((s) => s.addNotification);
  const [searchParams] = useSearchParams();

  const [labels, setLabels] = useState<Label[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);

  const fetchLabels = useCallback(async () => {
    try {
      const { data: response } = await labelsApi.getAll();
      setLabels(response.data);
    } catch {
      console.error('Failed to fetch labels');
    }
  }, []);

  // Apply URL filters on mount
  useEffect(() => {
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const overdue = searchParams.get('overdue');
    if (status) setFilter('status', status);
    if (priority) setFilter('priority', priority);
    if (overdue === 'true') setFilter('overdue', 'true');
  }, [searchParams, setFilter]);

  useEffect(() => {
    fetchTasks();
    fetchLabels();
  }, [fetchTasks, fetchLabels]);

  // Re-fetch when filters change
  const { filters, currentPage } = useTaskStore();
  useEffect(() => {
    fetchTasks();
  }, [filters, currentPage, fetchTasks]);

  const handleDelete = async () => {
    if (!deleteTask) return;
    try {
      await tasksApi.delete(deleteTask.id);
      addNotification({ kind: 'success', title: 'Task deleted' });
      setDeleteTask(null);
      fetchTasks();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete task' });
    }
  };

  const handleTaskUpdated = () => {
    fetchTasks();
    setEditTask(null);
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__info">
          <h1>Tasks</h1>
          <p className="page-header__subtitle">Manage and track all your tasks</p>
        </div>
        <Button renderIcon={Add} onClick={() => setCreateOpen(true)}>
          New Task
        </Button>
      </div>

      <TaskFilters labels={labels} />

      <Tabs>
        <TabList aria-label="Task views">
          <Tab>List View</Tab>
          <Tab>Kanban Board</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <TaskListView
              tasks={tasks}
              loading={loading}
              onEdit={setEditTask}
              onDelete={setDeleteTask}
            />
          </TabPanel>
          <TabPanel>
            <TaskKanbanView onCardClick={setEditTask} />
          </TabPanel>
        </TabPanels>
      </Tabs>

      <TaskCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          fetchTasks();
          setCreateOpen(false);
        }}
        labels={labels}
      />

      <TaskDetailModal
        task={editTask}
        open={!!editTask}
        onClose={() => setEditTask(null)}
        onUpdated={handleTaskUpdated}
        labels={labels}
      />

      <ConfirmDeleteModal
        open={!!deleteTask}
        title={deleteTask?.title || ''}
        onClose={() => setDeleteTask(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
