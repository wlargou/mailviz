import { useState, useEffect, useCallback } from 'react';
import {
  TextInput,
  TextArea,
  Dropdown,
  DatePicker,
  DatePickerInput,
  MultiSelect,
} from '@carbon/react';
import { CreateSidePanel } from '@carbon/ibm-products';
import { tasksApi } from '../../api/tasks';
import { customersApi } from '../../api/customers';
import { taskStatusesApi } from '../../api/taskStatuses';
import { useUIStore } from '../../store/uiStore';
import type { Label, TaskPriority, TaskStatus, TaskStatusConfig } from '../../types/task';
import type { Customer } from '../../types/customer';

const priorityItems = [
  { id: 'LOW', text: 'Low' },
  { id: 'MEDIUM', text: 'Medium' },
  { id: 'HIGH', text: 'High' },
  { id: 'URGENT', text: 'Urgent' },
];

interface TaskCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  labels: Label[];
}

export function TaskCreateModal({ open, onClose, onCreated, labels }: TaskCreateModalProps) {
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

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setStatus('TODO');
    setPriority('MEDIUM');
    setDueDate(null);
    setSelectedLabels([]);
    setCustomerId(null);
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      await tasksApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        dueDate,
        labelIds: selectedLabels.length > 0 ? selectedLabels : undefined,
        customerId: customerId || undefined,
      });
      addNotification({ kind: 'success', title: 'Task created', subtitle: title.trim() });
      resetForm();
      onCreated();
      onClose();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to create task' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <CreateSidePanel
      open={open}
      onRequestClose={() => { resetForm(); onClose(); }}
      onRequestSubmit={handleSubmit}
      title="Create New Task"
      subtitle="Add a task to track your work"
      formTitle="Task details"
      formDescription="Fill in the required fields to create a new task."
      primaryButtonText={loading ? 'Creating...' : 'Create'}
      secondaryButtonText="Cancel"
      disableSubmit={!title.trim() || loading}
      selectorPageContent=".app-content"
      selectorPrimaryFocus="#task-title"
    >
      <TextInput
        id="task-title"
        labelText="Title"
        placeholder="Enter task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        invalid={open && title.length > 0 && !title.trim()}
        invalidText="Title is required"
        className="create-side-panel__form-item"
      />
      <TextArea
        id="task-description"
        labelText="Description"
        placeholder="Enter task description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="create-side-panel__form-item"
      />
      <Dropdown
        id="task-status"
        titleText="Status"
        label="Select status"
        items={statusItems}
        itemToString={(item) => item?.text || ''}
        selectedItem={statusItems.find((s) => s.id === status)}
        onChange={({ selectedItem }) => {
          if (selectedItem) setStatus(selectedItem.id as TaskStatus);
        }}
        className="create-side-panel__form-item"
      />
      <Dropdown
        id="task-priority"
        titleText="Priority"
        label="Select priority"
        items={priorityItems}
        itemToString={(item) => item?.text || ''}
        selectedItem={priorityItems.find((p) => p.id === priority)}
        onChange={({ selectedItem }) => {
          if (selectedItem) setPriority(selectedItem.id as TaskPriority);
        }}
        className="create-side-panel__form-item"
      />
      <DatePicker
        datePickerType="single"
        onChange={([date]: Date[]) => {
          setDueDate(date ? date.toISOString() : null);
        }}
      >
        <DatePickerInput
          id="task-due-date"
          labelText="Due Date"
          placeholder="mm/dd/yyyy"
          className="create-side-panel__form-item"
        />
      </DatePicker>
      {customers.length > 0 && (
        <Dropdown
          id="task-customer"
          titleText="Company"
          label="Select company (optional)"
          items={[{ id: '', text: 'None' }, ...customers.map((c) => ({ id: c.id, text: c.name }))]}
          itemToString={(item) => item?.text || ''}
          selectedItem={customerId ? { id: customerId, text: customers.find((c) => c.id === customerId)?.name || '' } : { id: '', text: 'None' }}
          onChange={({ selectedItem }) => {
            setCustomerId(selectedItem?.id || null);
          }}
          className="create-side-panel__form-item"
        />
      )}
      {labels.length > 0 && (
        <MultiSelect
          id="task-labels"
          titleText="Labels"
          label="Select labels"
          items={labels.map((l) => ({ id: l.id, text: l.name }))}
          itemToString={(item) => item?.text || ''}
          onChange={({ selectedItems }) => {
            setSelectedLabels(selectedItems.map((item) => item.id));
          }}
          className="create-side-panel__form-item"
        />
      )}
    </CreateSidePanel>
  );
}
