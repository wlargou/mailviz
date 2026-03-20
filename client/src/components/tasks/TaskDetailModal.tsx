import { useState, useEffect, useCallback } from 'react';
import {
  TextInput,
  TextArea,
  Dropdown,
  DatePicker,
  DatePickerInput,
  MultiSelect,
  Button,
  Slider,
} from '@carbon/react';
import { SidePanel } from '@carbon/ibm-products';
import { Save, Share } from '@carbon/icons-react';
import { tasksApi } from '../../api/tasks';
import { taskStatusesApi } from '../../api/taskStatuses';
import { authApi } from '../../api/auth';
import { ShareDialog } from '../shared/ShareDialog';
import { CompanyComboBox } from '../shared/CompanyComboBox';
import { useUIStore } from '../../store/uiStore';
import type { Task, Label, TaskPriority, TaskStatus, TaskStatusConfig } from '../../types/task';

const priorityItems = [
  { id: 'LOW', text: 'Low' },
  { id: 'MEDIUM', text: 'Medium' },
  { id: 'HIGH', text: 'High' },
  { id: 'URGENT', text: 'Urgent' },
];

// Discrete effort values in minutes
const EFFORT_STEPS = [0, 5, 10, 15, 30, 60, 120, 240, 480];
const EFFORT_LABELS: Record<number, string> = {
  0: 'None', 5: '5 min', 10: '10 min', 15: '15 min',
  30: '30 min', 60: '1 hour', 120: '2 hours', 240: '4 hours', 480: '1 day',
};

function minutesToStepIndex(minutes: number | null): number {
  if (!minutes) return 0;
  const idx = EFFORT_STEPS.indexOf(minutes);
  return idx >= 0 ? idx : 0;
}

function stepIndexToMinutes(index: number): number | null {
  const val = EFFORT_STEPS[index] ?? 0;
  return val === 0 ? null : val;
}

interface TaskDetailModalProps {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
  labels: Label[];
}

export function TaskDetailModal({ task, open, onClose, onUpdated, labels }: TaskDetailModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('TODO');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [assignedToId, setAssignedToId] = useState<string | null>(null);
  const [effortIndex, setEffortIndex] = useState(0);
  const [users, setUsers] = useState<Array<{ id: string; name: string | null; email: string }>>([]);
  const [statusItems, setStatusItems] = useState<{ id: string; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [taskShares, setTaskShares] = useState<any[]>([]);
  const addNotification = useUIStore((s) => s.addNotification);

  const fetchStatuses = useCallback(async () => {
    try {
      const { data: res } = await taskStatusesApi.getAll();
      setStatusItems(res.data.map((s: TaskStatusConfig) => ({ id: s.name, text: s.label })));
    } catch { /* ignore */ }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const { data: res } = await authApi.getUsers();
      setUsers(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) {
      fetchStatuses();
      fetchUsers();
    }
  }, [open, fetchStatuses, fetchUsers]);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setStatus(task.status);
      setPriority(task.priority);
      setDueDate(task.dueDate);
      setSelectedLabels(task.labels.map((l) => l.id));
      setCustomerId(task.customerId);
      setAssignedToId(task.assignedToId || null);
      setEffortIndex(minutesToStepIndex(task.estimatedMinutes));
    }
  }, [task]);

  const handleSubmit = async () => {
    if (!task || !title.trim()) return;
    setLoading(true);
    try {
      await tasksApi.update(task.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        dueDate,
        labelIds: selectedLabels,
        customerId,
        assignedToId,
        estimatedMinutes: stepIndexToMinutes(effortIndex),
      });
      addNotification({ kind: 'success', title: 'Task updated' });
      onUpdated();
      onClose();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to update task' });
    } finally {
      setLoading(false);
    }
  };

  if (!task) return null;

  return (
    <SidePanel
      open={open}
      onRequestClose={onClose}
      title="Edit Task"
      size="md"
      className="task-detail-panel"
      actions={[
        {
          label: loading ? 'Saving...' : 'Save',
          onClick: handleSubmit,
          kind: 'primary' as const,
          disabled: !title.trim() || loading,
          icon: Save,
        },
      ]}
    >
      <div className="modal-form">
        <TextInput
          id="edit-task-title"
          labelText="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <TextArea
          id="edit-task-description"
          labelText="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="modal-form__row">
          <div style={{ flex: 1 }}>
            <Dropdown
              id="edit-task-status"
              titleText="Status"
              label="Select status"
              items={statusItems}
              itemToString={(item) => item?.text || ''}
              selectedItem={statusItems.find((s) => s.id === status)}
              onChange={({ selectedItem }) => {
                if (selectedItem) setStatus(selectedItem.id as TaskStatus);
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Dropdown
              id="edit-task-priority"
              titleText="Priority"
              label="Select priority"
              items={priorityItems}
              itemToString={(item) => item?.text || ''}
              selectedItem={priorityItems.find((p) => p.id === priority)}
              onChange={({ selectedItem }) => {
                if (selectedItem) setPriority(selectedItem.id as TaskPriority);
              }}
            />
          </div>
        </div>
        <DatePicker
          datePickerType="single"
          value={dueDate ? new Date(dueDate) : undefined}
          onChange={([date]: Date[]) => {
            setDueDate(date ? date.toISOString() : null);
          }}
        >
          <DatePickerInput
            id="edit-task-due-date"
            labelText="Due Date"
            placeholder="mm/dd/yyyy"
          />
        </DatePicker>
        <CompanyComboBox
          id="edit-task-customer"
          titleText="Company"
          selectedId={customerId}
          onChange={(id) => setCustomerId(id)}
          allowNone
        />
        <Dropdown
          id="edit-task-assigned"
          titleText="Assigned to"
          label="Unassigned"
          items={[{ id: '', text: 'Unassigned' }, ...users.map((u) => ({ id: u.id, text: u.name || u.email }))]}
          itemToString={(item: any) => item?.text || ''}
          selectedItem={assignedToId ? { id: assignedToId, text: users.find((u) => u.id === assignedToId)?.name || users.find((u) => u.id === assignedToId)?.email || '' } : { id: '', text: 'Unassigned' }}
          onChange={({ selectedItem }: any) => {
            setAssignedToId(selectedItem?.id || null);
          }}
        />
        <div className="modal-form__effort">
          <Slider
            id="edit-task-effort"
            labelText={`Estimated effort: ${EFFORT_LABELS[EFFORT_STEPS[effortIndex]] || 'None'}`}
            min={0}
            max={EFFORT_STEPS.length - 1}
            step={1}
            value={effortIndex}
            onChange={({ value }: { value: number }) => setEffortIndex(value)}
            hideTextInput
          />
        </div>
        {labels.length > 0 && (
          <MultiSelect
            id="edit-task-labels"
            titleText="Labels"
            label="Select labels"
            items={labels.map((l) => ({ id: l.id, text: l.name }))}
            itemToString={(item) => item?.text || ''}
            initialSelectedItems={labels
              .filter((l) => selectedLabels.includes(l.id))
              .map((l) => ({ id: l.id, text: l.name }))}
            onChange={({ selectedItems }) => {
              setSelectedLabels(selectedItems.map((item) => item.id));
            }}
          />
        )}
        {task.mailToTask?.email && (
          <div className="modal-form__source-email">
            <p className="modal-form__label" style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)', marginBottom: '0.25rem' }}>Created from email</p>
            <div
              role="button"
              tabIndex={0}
              className="modal-form__email-link"
              onClick={() => {
                onClose();
                // Navigate to mail page — the thread will be visible
                window.location.href = '/mail';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onClose();
                  window.location.href = '/mail';
                }
              }}
              style={{
                padding: '0.5rem 0.75rem',
                background: 'var(--cds-layer-02)',
                borderRadius: '4px',
                cursor: 'pointer',
                borderLeft: '3px solid var(--cds-link-primary)',
              }}
            >
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--cds-text-primary)' }}>
                {task.mailToTask.email.subject}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)', marginTop: '0.125rem' }}>
                From: {task.mailToTask.email.fromName || task.mailToTask.email.from}
              </div>
              {task.mailToTask.conversionNote && (
                <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)', marginTop: '0.25rem', fontStyle: 'italic' }}>
                  Note: {task.mailToTask.conversionNote}
                </div>
              )}
            </div>
          </div>
        )}
        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--cds-border-subtle)' }}>
          <Button
            kind="tertiary"
            size="sm"
            renderIcon={Share}
            onClick={async () => {
              if (!task) return;
              try {
                const { data: res } = await tasksApi.getTaskShares(task.id);
                setTaskShares(res.data);
              } catch { setTaskShares([]); }
              setShareOpen(true);
            }}
          >
            Share task
          </Button>
        </div>
      </div>

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={task?.title || ''}
        currentShares={taskShares}
        onShare={async (userIds) => {
          if (!task) return;
          await tasksApi.shareTask(task.id, userIds);
          addNotification({ kind: 'success', title: 'Task shared' });
        }}
        onUnshare={async (userId) => {
          if (!task) return;
          await tasksApi.unshareTask(task.id, userId);
          addNotification({ kind: 'success', title: 'Share removed' });
        }}
        onRefresh={async () => {
          if (!task) return;
          try {
            const { data: res } = await tasksApi.getTaskShares(task.id);
            setTaskShares(res.data);
          } catch { setTaskShares([]); }
        }}
      />
    </SidePanel>
  );
}
