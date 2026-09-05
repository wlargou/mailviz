import { useEffect, useState } from 'react';
import { DatePicker, DatePickerInput, Dropdown, InlineNotification, Modal } from '@carbon/react';
import { taskTemplatesApi, type TaskTemplate } from '../../api/taskTemplates';
import { CompanyComboBox } from '../shared/CompanyComboBox';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import { apiErrorMessage } from '../../utils/apiError';
import type { TaskLinkType } from '../../types/task';

interface ApplyTemplateModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-selected company, when opened from a company's page. */
  customerId?: string | null;
  /** Records every created top-level task is attached to. */
  links?: Array<{ entityType: TaskLinkType; entityId: string }>;
}

/**
 * Apply a task template: pick one, pick the day its offsets count from,
 * pick the company. A couple of fields, so a Modal — the Create Flows
 * rubric's smallest container.
 */
export function ApplyTemplateModal({ open, onClose, customerId: initialCustomerId = null, links }: ApplyTemplateModalProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null);
  const [selected, setSelected] = useState<TaskTemplate | null>(null);
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [customerId, setCustomerId] = useState<string | null>(initialCustomerId);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setAnchor(new Date());
    setCustomerId(initialCustomerId);
    taskTemplatesApi
      .getAll()
      .then(({ data: res }) => setTemplates(res.data))
      .catch(() => setTemplates([]));
  }, [open, initialCustomerId]);

  const apply = async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const { data: res } = await taskTemplatesApi.instantiate(selected.id, {
        anchorDate: anchor.toISOString(),
        customerId,
        links,
      });
      addNotification({
        kind: 'success',
        title: `Created ${res.data.created} ${res.data.created === 1 ? 'task' : 'tasks'}`,
        subtitle: `From “${selected.name}”`,
      });
      taskChanged();
      onClose();
    } catch (err) {
      addNotification({ kind: 'error', title: 'Could not apply the template', subtitle: apiErrorMessage(err, '') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      size="sm"
      modalHeading="New tasks from a template"
      primaryButtonText={busy ? 'Creating…' : selected ? `Create ${selected.taskCount} ${selected.taskCount === 1 ? 'task' : 'tasks'}` : 'Create'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!selected || busy}
      onRequestClose={onClose}
      onRequestSubmit={() => void apply()}
    >
      {templates && templates.length === 0 && (
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title="No templates yet"
          subtitle="Open a task and choose “Save as template” to keep its shape."
        />
      )}
      <div className="modal-form">
        <Dropdown
          id="apply-template-template"
          titleText="Template"
          label={templates ? 'Choose a template' : 'Loading…'}
          items={templates ?? []}
          itemToString={(t) => (t ? `${t.name} (${t.taskCount})` : '')}
          selectedItem={selected}
          onChange={({ selectedItem }) => setSelected(selectedItem ?? null)}
          disabled={!templates || templates.length === 0}
        />
        {selected?.description && <p className="modal-form__helper">{selected.description}</p>}
        <DatePicker
          datePickerType="single"
          value={anchor}
          onChange={([date]: Date[]) => {
            if (date) setAnchor(date);
          }}
        >
          <DatePickerInput id="apply-template-anchor" labelText="Day zero (offsets count from here)" placeholder="mm/dd/yyyy" />
        </DatePicker>
        <CompanyComboBox id="apply-template-customer" titleText="Company" selectedId={customerId} onChange={setCustomerId} allowNone />
      </div>
    </Modal>
  );
}
