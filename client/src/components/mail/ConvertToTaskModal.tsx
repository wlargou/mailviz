import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  TextInput,
  TextArea,
  Dropdown,
  Tag,
} from '@carbon/react';
import { CreateSidePanel } from '@carbon/ibm-products';
import { emailsApi } from '../../api/emails';
import { useUIStore } from '../../store/uiStore';
import type { EmailMessage } from '../../types/email';

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
  const [title, setTitle] = useState(email.subject);
  const [priority, setPriority] = useState('MEDIUM');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const addNotification = useUIStore((s) => s.addNotification);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await emailsApi.convertToTask(email.id, {
        title: title.trim(),
        priority: priority as any,
        notes: notes.trim() || undefined,
      });
      addNotification({ kind: 'success', title: 'Task created from email' });
      onConverted();
    } catch (err: any) {
      const msg = err?.response?.status === 409 ? 'Email already converted to task' : 'Failed to create task';
      addNotification({ kind: 'error', title: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <CreateSidePanel
      open={open}
      onRequestClose={onClose}
      onRequestSubmit={handleSubmit}
      title="Convert Email to Task"
      subtitle="Create a task linked to this email"
      formTitle="Task details"
      formDescription={`From: ${email.fromName || email.from}`}
      primaryButtonText={submitting ? 'Creating...' : 'Create Task'}
      secondaryButtonText="Cancel"
      disableSubmit={!title.trim() || submitting}
      selectorPageContent=".app-content"
      selectorPrimaryFocus="#convert-task-title"
    >
      <TextInput
        id="convert-task-title"
        labelText="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
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
      <div className="create-side-panel__form-item" style={{ display: 'flex', gap: '1rem' }}>
        <div>
          <p style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)', marginBottom: '0.25rem' }}>Status</p>
          <Tag type="blue" size="md">To Do</Tag>
        </div>
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
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Additional context..."
        rows={3}
        className="create-side-panel__form-item"
      />
    </CreateSidePanel>,
    document.body,
  );
}
