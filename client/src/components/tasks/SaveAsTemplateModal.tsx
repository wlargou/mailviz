import { useEffect, useState } from 'react';
import { Modal, TextArea, TextInput } from '@carbon/react';
import { taskTemplatesApi } from '../../api/taskTemplates';
import { useUIStore } from '../../store/uiStore';
import { apiErrorMessage } from '../../utils/apiError';

interface SaveAsTemplateModalProps {
  open: boolean;
  taskId: string;
  /** The task's title, as the suggested template name. */
  suggestedName: string;
  onClose: () => void;
}

/**
 * Keep a task's shape — subtasks, checklist, labels, priority, estimate,
 * and the spacing of its due dates — as a template. A name and a note.
 */
export function SaveAsTemplateModal({ open, taskId, suggestedName, onClose }: SaveAsTemplateModalProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const [name, setName] = useState(suggestedName);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(suggestedName);
      setDescription('');
    }
  }, [open, suggestedName]);

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { data: res } = await taskTemplatesApi.fromTask({ taskId, name: name.trim(), description: description.trim() || null });
      addNotification({
        kind: 'success',
        title: `Template “${res.data.name}” saved`,
        subtitle: `${res.data.taskCount} ${res.data.taskCount === 1 ? 'task' : 'tasks'} — apply it from the Tasks page.`,
      });
      onClose();
    } catch (err) {
      addNotification({ kind: 'error', title: 'Could not save the template', subtitle: apiErrorMessage(err, '') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      size="sm"
      modalHeading="Save as template"
      primaryButtonText={busy ? 'Saving…' : 'Save template'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!name.trim() || busy}
      onRequestClose={onClose}
      onRequestSubmit={() => void save()}
    >
      <div className="modal-form">
        <TextInput
          id="save-template-name"
          labelText="Template name"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          maxLength={120}
        />
        <TextArea
          id="save-template-description"
          labelText="Description (optional)"
          rows={2}
          value={description}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
          maxLength={500}
        />
      </div>
    </Modal>
  );
}
