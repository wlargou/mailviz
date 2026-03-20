import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  TextInput,
  TextArea,
  Dropdown,
  DatePicker,
  DatePickerInput,
  MultiSelect,
} from '@carbon/react';
import { tasksApi } from '../../api/tasks';
import { customersApi } from '../../api/customers';
import { taskStatusesApi } from '../../api/taskStatuses';
import { useUIStore } from '../../store/uiStore';
import type { Task, Label, TaskPriority, TaskStatus, TaskStatusConfig } from '../../types/task';
import type { Customer } from '../../types/customer';

const priorityItems = [
  { id: 'LOW', text: 'Low' },
  { id: 'MEDIUM', text: 'Medium' },
  { id: 'HIGH', text: 'High' },
  { id: 'URGENT', text: 'Urgent' },
];

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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [statusItems, setStatusItems] = useState<{ id: string; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const addNotification = useUIStore((s) => s.addNotification);

  const fetchCustomers = useCallback(async () => {
    try {
      const { data: res } = await customersApi.getAll({ limit: '100' });
      setCustomers(res.data);
    } catch { /* ignore */ }
  }, []);

  const fetchStatuses = useCallback(async () => {
    try {
      const { data: res } = await taskStatusesApi.getAll();
      setStatusItems(res.data.map((s: TaskStatusConfig) => ({ id: s.name, text: s.label })));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) {
      fetchCustomers();
      fetchStatuses();
    }
  }, [open, fetchCustomers, fetchStatuses]);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setStatus(task.status);
      setPriority(task.priority);
      setDueDate(task.dueDate);
      setSelectedLabels(task.labels.map((l) => l.id));
      setCustomerId(task.customerId);
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
    <Modal
      open={open}
      onRequestClose={onClose}
      onRequestSubmit={handleSubmit}
      modalHeading="Edit Task"
      primaryButtonText={loading ? 'Saving...' : 'Save'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!title.trim() || loading}
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
        {customers.length > 0 && (
          <Dropdown
            id="edit-task-customer"
            titleText="Company"
            label="Select company (optional)"
            items={[{ id: '', text: 'None' }, ...customers.map((c) => ({ id: c.id, text: c.name }))]}
            itemToString={(item) => item?.text || ''}
            selectedItem={customerId ? { id: customerId, text: customers.find((c) => c.id === customerId)?.name || '' } : { id: '', text: 'None' }}
            onChange={({ selectedItem }) => {
              setCustomerId(selectedItem?.id || null);
            }}
          />
        )}
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
      </div>
    </Modal>
  );
}
