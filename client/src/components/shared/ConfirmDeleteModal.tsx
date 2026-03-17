import { Modal } from '@carbon/react';

interface ConfirmDeleteModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteModal({ open, title, onClose, onConfirm }: ConfirmDeleteModalProps) {
  return (
    <Modal
      open={open}
      danger
      modalHeading="Delete Task"
      primaryButtonText="Delete"
      secondaryButtonText="Cancel"
      onRequestClose={onClose}
      onRequestSubmit={onConfirm}
    >
      <p>
        Are you sure you want to delete <strong>"{title}"</strong>? This action cannot be undone.
      </p>
    </Modal>
  );
}
