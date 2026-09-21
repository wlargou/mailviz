import { useState, useEffect, useCallback } from 'react';
import { TextInput } from '@carbon/react';
import { SidePanel } from '@carbon/ibm-products';
import { tasksApi } from '../../api/tasks';
import { taskStatusesApi } from '../../api/taskStatuses';
import { useUIStore } from '../../store/uiStore';
import type { Label } from '../../types/task';
import { useTaskStore } from '../../store/taskStore';
import { EMPTY_TASK_FORM, TaskFormFields, defaultStatus, taskFormToInput, toStatusItems, type StatusItem, type TaskFormValues } from './TaskFormFields';

interface TaskCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  labels: Label[];
}

export function TaskCreateModal({ open, onClose, onCreated, labels }: TaskCreateModalProps) {
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [title, setTitle] = useState('');
  const [form, setForm] = useState<TaskFormValues>(EMPTY_TASK_FORM);
  const [statusItems, setStatusItems] = useState<StatusItem[]>([]);
  const [loading, setLoading] = useState(false);
  const addNotification = useUIStore((s) => s.addNotification);

  const fetchStatuses = useCallback(async () => {
    try {
      const { data: res } = await taskStatusesApi.getAll();
      const items = toStatusItems(res.data);
      setStatusItems(items);
      setForm((prev) => ({ ...prev, status: defaultStatus(items, prev.status) }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) {
      fetchStatuses();
    }
  }, [open, fetchStatuses]);

  const resetForm = () => {
    setTitle('');
    setForm(EMPTY_TASK_FORM);
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      await tasksApi.create({ title: title.trim(), ...taskFormToInput(form) });
      addNotification({ kind: 'success', title: 'Task created', subtitle: title.trim() });
      resetForm();
      taskChanged();
      onCreated();
      onClose();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to create task' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SidePanel
      open={open}
      onRequestClose={() => { resetForm(); onClose(); }}
      title="Create New Task"
      subtitle="Add a task to track your work"
      size="md"
      actions={[
        {
          label: 'Create',
          onClick: handleSubmit,
          kind: 'primary' as const,
          disabled: !title.trim() || loading,
          loading,
        },
        {
          label: 'Cancel',
          onClick: () => { resetForm(); onClose(); },
          kind: 'secondary' as const,
        },
      ]}
    >
      <TextInput
        id="task-title"
        labelText="Title"
        placeholder="Enter task title"
        value={title}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
        invalid={open && title.length > 0 && !title.trim()}
        invalidText="Title is required"
        className="create-side-panel__form-item"
      />
      <TaskFormFields
        idPrefix="task"
        itemClassName="create-side-panel__form-item"
        values={form}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        statusItems={statusItems}
        labels={labels}
      />
    </SidePanel>
  );
}
