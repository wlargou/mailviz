import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  TextInput,
  TextArea,
  Dropdown,
  Tag,
  Modal,
  ContentSwitcher,
  Switch,
  ComboBox,
} from '@carbon/react';
import { useEffect, useRef } from 'react';
import { emailsApi } from '../../api/emails';
import { tasksApi } from '../../api/tasks';
import { useUIStore } from '../../store/uiStore';
import type { EmailMessage } from '../../types/email';
import { decodeEntities } from '../../utils/text';
import { useTaskStore } from '../../store/taskStore';

interface ConvertToTaskModalProps {
  email: EmailMessage;
  open: boolean;
  onClose: () => void;
  onConverted: () => void;
}

const priorityItems = [
  { id: 'LOW', text: 'Low' },
  { id: 'MEDIUM', text: 'Medium' },
  { id: 'HIGH', text: 'High' },
  { id: 'URGENT', text: 'Urgent' },
];

export function ConvertToTaskModal({ email, open, onClose, onConverted }: ConvertToTaskModalProps) {
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [title, setTitle] = useState(decodeEntities(email.subject));
  const [priority, setPriority] = useState('MEDIUM');
  const [notes, setNotes] = useState('');
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

  useEffect(() => {
    if (!open) {
      setMode('new');
      setExisting(null);
      setCandidates([]);
    }
  }, [open]);

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
        priority: priority as any,
        notes: notes.trim() || undefined,
      });
      addNotification({ kind: 'success', title: 'Task created from email' });
      taskChanged();
      onConverted();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to create task' });
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <Modal
      open={open}
      onRequestClose={onClose}
      onRequestSubmit={handleSubmit}
      onSecondarySubmit={onClose}
      modalHeading={mode === 'new' ? 'Convert Email to Task' : 'Attach Email to Task'}
      modalLabel={mode === 'new' ? 'Create a task linked to this email' : 'Add this email to a task that already exists'}
      size="sm"
      primaryButtonText={mode === 'new' ? 'Create Task' : 'Attach'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={submitting || (mode === 'new' ? !title.trim() : !existing)}
      loadingStatus={submitting ? 'active' : 'inactive'}
      loadingDescription="Creating task..."
      selectorPrimaryFocus="#convert-task-title"
    >
      <ContentSwitcher
        size="sm"
        selectedIndex={mode === 'new' ? 0 : 1}
        onChange={({ index }: { index?: number }) => setMode(index === 1 ? 'existing' : 'new')}
        className="create-side-panel__form-item"
      >
        <Switch name="new" text="New task" />
        <Switch name="existing" text="Existing task" />
      </ContentSwitcher>
      {mode === 'existing' && (
        <div className="create-side-panel__form-item">
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
        className="create-side-panel__form-item"
      />
      <Dropdown
        id="convert-task-priority"
        titleText="Priority"
        label="Priority"
        items={priorityItems}
        itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
        selectedItem={priorityItems.find((p) => p.id === priority) || priorityItems[1]}
        onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => {
          setPriority(selectedItem?.id || 'MEDIUM');
        }}
        className="create-side-panel__form-item"
      />
      </>
      )}
      <div className="create-side-panel__form-item" style={{ display: 'flex', gap: '1rem' }}>
        {/* The status is the new task's; an existing task keeps its own. */}
        {mode === 'new' && (
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)', marginBottom: '0.25rem' }}>Status</p>
            <Tag type="blue" size="md">To Do</Tag>
          </div>
        )}
        {email.customer && (
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)', marginBottom: '0.25rem' }}>Customer</p>
            <Tag type="teal" size="md">{email.customer.name}</Tag>
          </div>
        )}
      </div>
      <TextArea
        id="convert-task-notes"
        labelText="Notes"
        value={notes}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
        placeholder="Additional context..."
        rows={3}
        className="create-side-panel__form-item"
      />
    </Modal>,
    document.body,
  );
}
