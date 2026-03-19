import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Modal,
  TextInput,
  TextArea,
  Dropdown,
  Tag,
} from '@carbon/react';
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
    <Modal
      open={open}
      onRequestClose={onClose}
      onRequestSubmit={handleSubmit}
      modalHeading="Convert Email to Task"
      primaryButtonText={submitting ? 'Creating...' : 'Create Task'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!title.trim() || submitting}
    >
      <div className="modal-form">
        <TextInput
          id="task-title"
          labelText="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <Dropdown
          id="task-priority"
          titleText="Priority"
          label="Priority"
          items={priorityItems}
          itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
          selectedItem={priorityItems.find((p) => p.id === priority) || priorityItems[1]}
          onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => {
            setPriority(selectedItem?.id || 'MEDIUM');
          }}
        />
        <div className="modal-form__row">
          <div style={{ flex: 1 }}>
            <p className="modal-form__label">Status</p>
            <Tag type="blue" size="md">To Do</Tag>
          </div>
          {email.customer && (
            <div style={{ flex: 1 }}>
              <p className="modal-form__label">Customer</p>
              <Tag type="teal" size="md">{email.customer.name}</Tag>
            </div>
          )}
        </div>
        <TextArea
          id="task-notes"
          labelText="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Additional context..."
          rows={3}
        />
        <p className="modal-form__helper">
          From: {email.fromName || email.from} · {email.snippet?.slice(0, 100)}
        </p>
      </div>
    </Modal>,
    document.body,
  );
}
