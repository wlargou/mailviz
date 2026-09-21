import { useState, useEffect, useRef } from 'react';
import { TextInput, TextArea, ContentSwitcher, Switch, ComboBox } from '@carbon/react';
import { TearsheetNarrow } from '@carbon/ibm-products';
import { emailsApi } from '../../api/emails';
import { tasksApi } from '../../api/tasks';
import { taskStatusesApi } from '../../api/taskStatuses';
import { labelsApi } from '../../api/labels';
import { useUIStore } from '../../store/uiStore';
import type { EmailMessage } from '../../types/email';
import type { Label } from '../../types/task';
import { decodeEntities } from '../../utils/text';
import { useTaskStore } from '../../store/taskStore';
import { EMPTY_TASK_FORM, TaskFormFields, defaultStatus, taskFormToInput, toStatusItems, type StatusItem, type TaskFormValues } from '../tasks/TaskFormFields';

interface ConvertToTaskModalProps {
  email: EmailMessage;
  open: boolean;
  onClose: () => void;
  onConverted: () => void;
}

/**
 * What the form starts from: the email's own subject, snippet and company.
 * Every one of them is editable — the email is a suggestion, not the task.
 */
function seedFrom(email: EmailMessage): TaskFormValues {
  return {
    ...EMPTY_TASK_FORM,
    description: decodeEntities(email.snippet ?? ''),
    customerId: email.customer?.id ?? null,
  };
}

/**
 * A TearsheetNarrow, not the `Modal sm` this used to be: with the full task
 * form inside it is past what a small modal holds, and it may obscure the
 * page — the reader of the email has already decided to act on it. The
 * date pickers append to `<body>`, so they are named as floating menus or
 * the tearsheet's focus wrap steals the calendar's clicks.
 */
export function ConvertToTaskModal({ email, open, onClose, onConverted }: ConvertToTaskModalProps) {
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [title, setTitle] = useState(() => decodeEntities(email.subject));
  const [form, setForm] = useState<TaskFormValues>(() => seedFrom(email));
  const [notes, setNotes] = useState('');
  const [statusItems, setStatusItems] = useState<StatusItem[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const addNotification = useUIStore((s) => s.addNotification);
  /**
   * Two ways in: a new task from this email, or attaching it to one that
   * already exists — a reply to a request that is already being worked on
   * belongs on that task, not on a second one.
   */
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [existing, setExisting] = useState<{ id: string; text: string } | null>(null);
  const [candidates, setCandidates] = useState<Array<{ id: string; text: string }>>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reseed on every open: the same modal instance serves one email after
  // another, and a due date picked for the last one must not carry over.
  useEffect(() => {
    if (!open) return;
    setMode('new');
    setExisting(null);
    setCandidates([]);
    setTitle(decodeEntities(email.subject));
    setForm(seedFrom(email));
    setNotes('');
    (async () => {
      try {
        const [{ data: statuses }, { data: labelRes }] = await Promise.all([taskStatusesApi.getAll(), labelsApi.getAll()]);
        const items = toStatusItems(statuses.data);
        setStatusItems(items);
        setForm((prev) => ({ ...prev, status: defaultStatus(items, prev.status) }));
        setLabels(labelRes.data);
      } catch { /* the form still works without the option lists */ }
    })();
  }, [open, email]);

  const searchTasks = (query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const { data: res } = await tasksApi.getAll({ search: query, limit: '10', sortBy: 'updatedAt', sortOrder: 'desc' });
        setCandidates(res.data.map((t) => ({ id: t.id, text: decodeEntities(t.title) })));
      } catch {
        setCandidates([]);
      }
    }, 300);
  };

  const handleSubmit = async () => {
    if (mode === 'existing') {
      if (!existing) return;
      setSubmitting(true);
      try {
        await emailsApi.attachToTask(email.id, existing.id, notes.trim() || undefined);
        addNotification({ kind: 'success', title: 'Email attached to task', subtitle: existing.text });
        taskChanged();
        onConverted();
      } catch {
        addNotification({ kind: 'error', title: 'Failed to attach the email' });
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await emailsApi.convertToTask(email.id, {
        title: title.trim(),
        ...taskFormToInput(form),
        notes: notes.trim() || undefined,
      });
      addNotification({ kind: 'success', title: 'Task created from email', subtitle: title.trim() });
      taskChanged();
      onConverted();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to create task' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <TearsheetNarrow
      open={open}
      onClose={onClose}
      title={mode === 'new' ? 'Convert Email to Task' : 'Attach Email to Task'}
      label="Mail"
      description={mode === 'new' ? 'Create a task linked to this email' : 'Add this email to a task that already exists'}
      hasCloseIcon
      selectorPrimaryFocus="#convert-task-title"
      selectorsFloatingMenus={['.cds--date-picker__calendar']}
      actions={[
        {
          label: mode === 'new' ? 'Create Task' : 'Attach',
          onClick: handleSubmit,
          kind: 'primary' as const,
          disabled: submitting || (mode === 'new' ? !title.trim() : !existing),
          loading: submitting,
        },
        {
          label: 'Cancel',
          onClick: onClose,
          kind: 'secondary' as const,
        },
      ]}
    >
      <div className="tearsheet-form__item">
        <ContentSwitcher
          size="sm"
          selectedIndex={mode === 'new' ? 0 : 1}
          onChange={({ index }: { index?: number }) => setMode(index === 1 ? 'existing' : 'new')}
        >
          <Switch name="new" text="New task" />
          <Switch name="existing" text="Existing task" />
        </ContentSwitcher>
      </div>
      {mode === 'existing' && (
        <div className="tearsheet-form__item">
          <ComboBox
            id="convert-task-existing"
            titleText="Task"
            placeholder="Search a task…"
            items={candidates}
            itemToString={(item: { id: string; text: string } | null) => item?.text ?? ''}
            onInputChange={(text: string) => searchTasks(text)}
            onChange={({ selectedItem }: { selectedItem?: { id: string; text: string } | null }) => setExisting(selectedItem ?? null)}
            selectedItem={existing}
          />
        </div>
      )}
      {mode === 'new' && (
        <>
          <TextInput
            id="convert-task-title"
            labelText="Task title"
            value={title}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            invalid={open && title.length > 0 && !title.trim()}
            invalidText="Title is required"
            className="tearsheet-form__item"
          />
          <TaskFormFields
            idPrefix="convert-task"
            itemClassName="tearsheet-form__item"
            values={form}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            statusItems={statusItems}
            labels={labels}
          />
        </>
      )}
      <TextArea
        id="convert-task-notes"
        labelText="Notes"
        helperText="Kept on the link between the email and the task, not on the task itself"
        value={notes}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
        placeholder="Why this email became a task..."
        rows={3}
        className="tearsheet-form__item"
      />
    </TearsheetNarrow>
  );
}
