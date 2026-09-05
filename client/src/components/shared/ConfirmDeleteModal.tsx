import { Modal } from '@carbon/react';

interface ConfirmDeleteModalProps {
  open: boolean;
  /** Name of the specific record being deleted, shown in the body copy. */
  title: string;
  /**
   * What is being deleted, e.g. "company". Used to build the modal heading.
   * Required because this modal is shared across tasks, companies, contacts
   * and deals — it previously hardcoded "Delete Task" for all of them.
   */
  entityLabel: string;
  /** An extra sentence about what goes with it, e.g. "Its 3 subtasks will be deleted too." */
  consequence?: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteModal({
  open,
  title,
  entityLabel,
  consequence,
  onClose,
  onConfirm,
}: ConfirmDeleteModalProps) {
  return (
    <Modal
      open={open}
      danger
      modalHeading={`Delete ${entityLabel}`}
      primaryButtonText="Delete"
      secondaryButtonText="Cancel"
      onRequestClose={onClose}
      onRequestSubmit={onConfirm}
    >
      <p>
        Are you sure you want to delete <strong>"{title}"</strong>? This action cannot be undone.
      </p>
      {consequence && <p>{consequence}</p>}
    </Modal>
  );
}
