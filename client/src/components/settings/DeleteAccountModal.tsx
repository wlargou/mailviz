import { Modal, TextInput, UnorderedList, ListItem } from '@carbon/react';
import type { AccountDeletionSummary } from '../../api/auth';

interface DeleteAccountModalProps {
  open: boolean;
  /** Null while the counts are still loading. */
  summary: AccountDeletionSummary | null;
  confirmText: string;
  onConfirmTextChange: (value: string) => void;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * The confirmation for the one irreversible action in the product.
 *
 * Extracted from SettingsPage so the guard can be tested on its own. Two things
 * it deliberately does:
 *
 *  - **Shows real counts, not a generic warning.** "This will delete all your
 *    data" is a sentence people click through. "This will delete 25,431 emails"
 *    is one they read. The numbers come from the server, so they are what will
 *    actually happen rather than what the UI assumes.
 *  - **Says what survives.** A task assigned to you but owned by a colleague is
 *    unassigned, not deleted, and shared items stay with their owners. Without
 *    that, the dialog reads as "and possibly other people's work too", which is
 *    both alarming and untrue.
 *
 * The typed-address check is a UX guard only. The server re-checks it, because
 * a disabled button is not a security control.
 */
export function DeleteAccountModal({
  open,
  summary,
  confirmText,
  onConfirmTextChange,
  deleting,
  onClose,
  onConfirm,
}: DeleteAccountModalProps) {
  // Trimmed and case-insensitive: retyping your own address should not fail on
  // a capital letter or a trailing space picked up from a copy-paste.
  const confirmed =
    summary !== null && confirmText.trim().toLowerCase() === summary.email.toLowerCase();

  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  return (
    <Modal
      open={open}
      danger
      modalHeading="Delete account"
      primaryButtonText={deleting ? 'Deleting…' : 'Delete my account'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={deleting || !confirmed}
      // Closing mid-request would leave the user on a page whose account is
      // being deleted underneath them.
      onRequestClose={() => {
        if (!deleting) onClose();
      }}
      onRequestSubmit={onConfirm}
    >
      {!summary ? (
        <p>Loading what this will remove…</p>
      ) : (
        <>
          <p style={{ marginBottom: '1rem' }}>
            <strong>This cannot be undone.</strong> Deleting <strong>{summary.email}</strong>{' '}
            permanently removes:
          </p>
          <UnorderedList>
            <ListItem>
              {summary.emails.toLocaleString()} emails and {summary.drafts.toLocaleString()} drafts
            </ListItem>
            <ListItem>{summary.calendarEvents.toLocaleString()} calendar events</ListItem>
            <ListItem>
              {summary.companies.toLocaleString()} companies and{' '}
              {summary.contacts.toLocaleString()} contacts
            </ListItem>
            <ListItem>
              {summary.tasks.toLocaleString()} tasks and {summary.deals.toLocaleString()} deals
            </ListItem>
            <ListItem>
              {summary.labels.toLocaleString()} labels and {summary.templates.toLocaleString()}{' '}
              templates
            </ListItem>
            {summary.googleConnected && (
              <ListItem>Your Google connection (the grant is revoked too)</ListItem>
            )}
          </UnorderedList>

          {(summary.assignedByOthers > 0 || summary.sharesGiven > 0) && (
            <p style={{ marginTop: '1rem' }}>
              {summary.assignedByOthers > 0 && (
                <>
                  {summary.assignedByOthers.toLocaleString()}{' '}
                  {plural(summary.assignedByOthers, 'task', 'tasks')} assigned to you but owned by
                  someone else {plural(summary.assignedByOthers, 'is', 'are')} kept and simply
                  unassigned.{' '}
                </>
              )}
              {summary.sharesGiven > 0 && (
                <>
                  {summary.sharesGiven.toLocaleString()}{' '}
                  {plural(summary.sharesGiven, 'item', 'items')} you shared will stop being shared,
                  but the originals stay with their owners.
                </>
              )}
            </p>
          )}

          <div style={{ marginTop: '1.5rem' }}>
            <TextInput
              id="delete-account-confirm"
              labelText={`Type ${summary.email} to confirm`}
              placeholder={summary.email}
              value={confirmText}
              disabled={deleting}
              onChange={(e) => onConfirmTextChange(e.target.value)}
              autoComplete="off"
            />
          </div>
        </>
      )}
    </Modal>
  );
}
