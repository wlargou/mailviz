import { useState, useEffect, useCallback } from 'react';
import {
  TextInput,
  TextArea,
  Dropdown,
  DatePicker,
  DatePickerInput,
  MultiSelect,
} from '@carbon/react';
import { SidePanel } from '@carbon/ibm-products';
import { tasksApi } from '../../api/tasks';
import { taskStatusesApi } from '../../api/taskStatuses';
import { CompanyComboBox } from '../shared/CompanyComboBox';
import { useUIStore } from '../../store/uiStore';
import type { Label, TaskPriority, TaskStatus, TaskStatusConfig } from '../../types/task';
import { useTaskStore } from '../../store/taskStore';
import { buildRecurrenceOptions, buildRecurrenceRules, type RecurrencePresetId } from '../../utils/recurrence';
import { REMINDER_OPTIONS, reminderFor, type ReminderPresetId } from '../../utils/reminders';

const priorityItems = [
  { id: 'LOW', text: 'Low' },
  { id: 'MEDIUM', text: 'Medium' },
  { id: 'HIGH', text: 'High' },
  { id: 'URGENT', text: 'Urgent' },
];

interface LabelItem {
  id: string;
  text: string;
}

interface TaskCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  labels: Label[];
}

export function TaskCreateModal({ open, onClose, onCreated, labels }: TaskCreateModalProps) {
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('TODO');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [recurrencePreset, setRecurrencePreset] = useState<RecurrencePresetId>('none');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [reminder, setReminder] = useState<ReminderPresetId>('none');
  const [statusItems, setStatusItems] = useState<{ id: string; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const addNotification = useUIStore((s) => s.addNotification);

  const fetchStatuses = useCallback(async () => {
    try {
      const { data: res } = await taskStatusesApi.getAll();
      setStatusItems(res.data.map((s: TaskStatusConfig) => ({ id: s.name, text: s.label })));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) {
      fetchStatuses();
    }
  }, [open, fetchStatuses]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setStatus('TODO');
    setPriority('MEDIUM');
    setDueDate(null);
    setSelectedLabels([]);
    setCustomerId(null);
    setRecurrencePreset('none');
    setStartDate(null);
    setReminder('none');
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
        recurrence: dueDate ? buildRecurrenceRules(recurrencePreset, new Date(dueDate))[0] ?? undefined : undefined,
        startDate: startDate ?? undefined,
        remindAt: reminderFor(reminder, dueDate ? new Date(dueDate) : null)?.toISOString() ?? undefined,
      });
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
      <TextArea
        id="task-description"
        labelText="Description"
        placeholder="Enter task description (optional)"
        value={description}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
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
      <DatePicker
        datePickerType="single"
        onChange={([date]: Date[]) => {
          setStartDate(date ? date.toISOString() : null);
        }}
      >
        <DatePickerInput
          id="task-start-date"
          labelText="Start Date"
          placeholder="mm/dd/yyyy"
          className="create-side-panel__form-item"
        />
      </DatePicker>
      <Dropdown
        id="task-reminder"
        titleText="Reminder"
        label="No reminder"
        helperText={dueDate ? undefined : 'Set a due date first'}
        disabled={!dueDate}
        items={REMINDER_OPTIONS}
        itemToString={(item) => item?.label || ''}
        selectedItem={REMINDER_OPTIONS.find((o) => o.id === (dueDate ? reminder : 'none'))}
        onChange={({ selectedItem }) => {
          if (selectedItem) setReminder(selectedItem.id);
        }}
        className="create-side-panel__form-item"
      />
      <Dropdown
        id="task-recurrence"
        titleText="Repeat"
        label="Does not repeat"
        helperText={dueDate ? undefined : 'Set a due date to repeat from'}
        disabled={!dueDate}
        items={buildRecurrenceOptions(dueDate ? new Date(dueDate) : new Date())}
        itemToString={(item) => item?.label || ''}
        selectedItem={buildRecurrenceOptions(dueDate ? new Date(dueDate) : new Date()).find((o) => o.id === (dueDate ? recurrencePreset : 'none'))}
        onChange={({ selectedItem }) => {
          if (selectedItem) setRecurrencePreset(selectedItem.id);
        }}
        className="create-side-panel__form-item"
      />
      <div className="create-side-panel__form-item">
        <CompanyComboBox
          id="task-customer"
          titleText="Company"
          selectedId={customerId}
          onChange={(id) => setCustomerId(id)}
          allowNone
        />
      </div>
      <MultiSelect
        id="task-labels"
        titleText="Labels"
        disabled={labels.length === 0}
        helperText={labels.length === 0 ? 'No labels available. Add some in Settings.' : undefined}
        label="Select labels"
        items={labels.map((l) => ({ id: l.id, text: l.name }))}
        itemToString={(item: LabelItem | null) => item?.text || ''}
        onChange={({ selectedItems }: { selectedItems: LabelItem[] }) => {
          setSelectedLabels(selectedItems.map((item: LabelItem) => item.id));
        }}
        className="create-side-panel__form-item"
      />
    </SidePanel>
  );
}
