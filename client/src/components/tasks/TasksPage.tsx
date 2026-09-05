import { useEffect, useState, useCallback } from 'react';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from '@carbon/react';
import { useSearchParams } from 'react-router-dom';
import { TaskListView } from './TaskListView';
import { TaskByCompanyView } from './TaskByCompanyView';
import { TaskKanbanView } from './TaskKanbanView';
import { TaskCreateModal } from './TaskCreateModal';
import { TaskDetailModal } from './TaskDetailModal';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import { labelsApi } from '../../api/labels';
import { tasksApi } from '../../api/tasks';
import type { Task, Label } from '../../types/task';
import { decodeEntities } from '../../utils/text';

export function TasksPage() {
  const { tasks, loading, fetchTasks, setFilter } = useTaskStore();
  const addNotification = useUIStore((s) => s.addNotification);
  const [searchParams] = useSearchParams();

  const [labels, setLabels] = useState<Label[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  // An id, not the object. Handing the panel a row captured at click time
  // is what let it re-seed stale values and save them back.
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);

  const fetchLabels = useCallback(async () => {
    try {
      const { data: response } = await labelsApi.getAll();
      setLabels(response.data);
    } catch {
      // Not console-only: the pickers render an empty-but-present control when
      // this fails, and without a word here that is indistinguishable from an
      // account that simply has no labels yet.
      addNotification({ kind: 'error', title: 'Could not load labels' });
    }
  }, [addNotification]);

  // Apply URL filters on mount
  useEffect(() => {
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const overdue = searchParams.get('overdue');
    const search = searchParams.get('search');
    if (status) setFilter('status', status);
    if (priority) setFilter('priority', priority);
    if (overdue === 'true') setFilter('overdue', 'true');
    if (search) setFilter('search', search);
    // `?task=<id>` opens that task's panel — how a notification about a
    // comment or a mention lands on the thing it is about.
    const task = searchParams.get('task');
    if (task) setEditTaskId(task);
  }, [searchParams, setFilter]);

  useEffect(() => {
    fetchTasks();
    fetchLabels();
  }, [fetchTasks, fetchLabels]);

  /**
   * Re-fetch when anything the request depends on changes.
   *
   * `pageSize` belongs in this list and was missing. `setPageSize` also resets
   * `currentPage` to 1, so changing "Items per page" while already on page 1
   * altered no dependency and fired no request: the pagination label updated to
   * "1–40 of 40" while the table went on rendering the 20 rows it already had.
   *
   * Subscribed field by field rather than destructuring the store, which
   * subscribes to every write — including the ones fetchTasks itself makes.
   */
  const filters = useTaskStore((s) => s.filters);
  const currentPage = useTaskStore((s) => s.currentPage);
  const pageSize = useTaskStore((s) => s.pageSize);
  // Every task write bumps this, wherever it happened — including in views
  // that never touch this store. It is what replaces the hand-placed
  // fetchTasks() calls the mutation handlers below used to make.
  const tasksVersion = useTaskStore((s) => s.tasksVersion);
  const taskChanged = useTaskStore((s) => s.taskChanged);
  useEffect(() => {
    fetchTasks();
  }, [filters, currentPage, pageSize, tasksVersion, fetchTasks]);

  const handleDelete = async () => {
    if (!deleteTask) return;
    try {
      await tasksApi.delete(deleteTask.id);
      addNotification({ kind: 'success', title: 'Task deleted' });
      setDeleteTask(null);
      taskChanged();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete task' });
    }
  };

  const handleTaskUpdated = () => {
    setEditTaskId(null);
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__info">
          <h1>Tasks</h1>
          <p className="page-header__subtitle">Manage and track all your tasks</p>
        </div>
      </div>

          <Tabs>
            <TabList aria-label="Task views">
              <Tab>List View</Tab>
              <Tab>Kanban Board</Tab>
              <Tab>By Company</Tab>
            </TabList>
            <TabPanels>
              <TabPanel>
                <TaskListView
                  tasks={tasks}
                  loading={loading}
                  labels={labels}
                  onEdit={setEditTaskId}
                  onDelete={setDeleteTask}
                  onCreateNew={() => setCreateOpen(true)}
                />
              </TabPanel>
              <TabPanel>
                <TaskKanbanView onCardClick={setEditTaskId} />
              </TabPanel>
              <TabPanel>
                <TaskByCompanyView
                  labels={labels}
                  onEdit={setEditTaskId}
                  onDelete={setDeleteTask}
                  onCreateNew={() => setCreateOpen(true)}
                />
              </TabPanel>
            </TabPanels>
          </Tabs>

      <TaskCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
        }}
        labels={labels}
      />

      <TaskDetailModal
        taskId={editTaskId}
        open={!!editTaskId}
        onClose={() => setEditTaskId(null)}
        onUpdated={handleTaskUpdated}
        onOpenTask={setEditTaskId}
        labels={labels}
      />

      <ConfirmDeleteModal
        open={!!deleteTask}
        title={decodeEntities(deleteTask?.title)}
        entityLabel="task"
        consequence={
          deleteTask && deleteTask.subtaskCount > 0
            ? `Its ${deleteTask.subtaskCount} ${deleteTask.subtaskCount === 1 ? 'subtask' : 'subtasks'} will be deleted with it.`
            : undefined
        }
        onClose={() => setDeleteTask(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
