import { useEffect, useState } from 'react';
import { Dropdown, Modal } from '@carbon/react';

export interface PickerItem {
  id: string;
  text: string;
}

interface TaskBatchPickerProps {
  open: boolean;
  /** "Move 4 tasks to…" */
  heading: string;
  label: string;
  items: PickerItem[];
  onClose: () => void;
  onPick: (item: PickerItem) => Promise<void> | void;
}

/**
 * One choice for a batch: which status, which assignee, which label. A
 * dropdown in a small Modal — the batch bar has no room for a picker and a
 * choice this cheap does not deserve a panel.
 */
export function TaskBatchPicker({ open, heading, label, items, onClose, onPick }: TaskBatchPickerProps) {
  const [picked, setPicked] = useState<PickerItem | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setPicked(null);
  }, [open]);

  return (
    <Modal
      open={open}
      size="xs"
      modalHeading={heading}
      primaryButtonText={busy ? 'Applying…' : 'Apply'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!picked || busy}
      onRequestClose={onClose}
      onRequestSubmit={async () => {
        if (!picked) return;
        setBusy(true);
        try {
          await onPick(picked);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Dropdown
        id="task-batch-picker"
        titleText={label}
        label={`Choose ${label.toLowerCase()}`}
        items={items}
        itemToString={(item) => item?.text ?? ''}
        selectedItem={picked}
        onChange={({ selectedItem }) => setPicked(selectedItem ?? null)}
      />
    </Modal>
  );
}
