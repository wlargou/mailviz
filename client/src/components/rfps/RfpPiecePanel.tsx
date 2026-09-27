import { useState } from 'react';
import { createPortal } from 'react-dom';
import { SidePanel } from '@carbon/ibm-products';
import { Button, FileUploaderButton, InlineLoading, Tag, TextArea } from '@carbon/react';
import { Checkmark, Download, Edit, TrashCan, Undo } from '@carbon/icons-react';
import { rfpsApi } from '../../api/rfps';
import { useUIStore } from '../../store/uiStore';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { formatFileSize } from '../../utils/fileTypes';
import { PersonAvatar, VERIFICATION_STATE_LABELS, When } from './RfpPeople';
import {
  currentVersion,
  personName,
  RFP_ITEM_STATUS_LABELS,
  RFP_ITEM_STATUS_TAG_TYPE,
  verificationStates,
  type RfpDocument,
  type RfpItem,
  type RfpVerifier,
  type VerificationState,
} from '../../types/rfp';

/** Mirrors the server's whitelist in `services/rfpStorage.ts`. */
export const PIECE_ACCEPTED = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.txt', '.csv', '.png', '.jpg', '.jpeg'];

const STATE_TAG: Record<VerificationState, 'green' | 'red' | 'warm-gray' | 'gray'> = {
  approved: 'green',
  changes: 'red',
  stale: 'warm-gray',
  pending: 'gray',
};

interface RfpPiecePanelProps {
  rfpId: string;
  /** The piece, read from the tender on every render — so a refresh updates it. */
  item: RfpItem | null;
  folderTitle: string;
  verifiers: RfpVerifier[];
  currentUserId: string | undefined;
  onClose: () => void;
  onPreview: (item: RfpItem, index: number) => void;
  onRefresh: () => Promise<void> | void;
}

/**
 * Everything about one piece: the current version and who handed it in, what
 * each verifier made of it, and the versions before it.
 *
 * A SidePanel because the page is the context — the dossier the piece
 * belongs to stays in view beside it.
 */
export function RfpPiecePanel({ rfpId, item, folderTitle, verifiers, currentUserId, onClose, onPreview, onRefresh }: RfpPiecePanelProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [comment, setComment] = useState('');
  const [deleteVersion, setDeleteVersion] = useState<RfpDocument | null>(null);

  const current = item ? currentVersion(item) : null;
  const states = item ? verificationStates(item, verifiers) : [];
  const mine = states.find((s) => s.person.id === currentUserId) ?? null;

  const upload = async (files: FileList | null) => {
    if (!item || !files || files.length === 0) return;
    setUploading(true);
    try {
      await rfpsApi.uploadItemDocument(rfpId, item.id, files[0]);
      addNotification({ kind: 'success', title: `Version ${(current?.version ?? 0) + 1} uploaded`, subtitle: files[0].name });
      await onRefresh();
    } catch {
      addNotification({ kind: 'error', title: 'Upload failed', subtitle: 'Check the file type and that it is under 25 MB.' });
    } finally {
      setUploading(false);
    }
  };

  const decide = async (decision: 'APPROVED' | 'CHANGES_REQUESTED') => {
    if (!item) return;
    setBusy(true);
    try {
      await rfpsApi.decide(rfpId, item.id, { decision, comment: decision === 'CHANGES_REQUESTED' ? comment.trim() : null });
      setRequesting(false);
      setComment('');
      await onRefresh();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to record your decision' });
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await rfpsApi.withdrawDecision(rfpId, item.id);
      await onRefresh();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to withdraw your decision' });
    } finally {
      setBusy(false);
    }
  };

  const removeVersion = async () => {
    if (!deleteVersion) return;
    try {
      await rfpsApi.deleteDocument(rfpId, deleteVersion.id);
      setDeleteVersion(null);
      await onRefresh();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete the version' });
    }
  };

  const versionsNewestFirst = item ? [...item.documents].reverse() : [];

  return (
    <>
      <SidePanel
        open={item !== null}
        onRequestClose={onClose}
        title={item?.title ?? ''}
        subtitle={folderTitle}
        size="md"
        includeOverlay={false}
        // The preview and the confirmation open over the page, outside the
        // panel; a click in them must not close it.
        preventCloseOnClickOutside
        className="rfp-piece-panel"
      >
        {item && (
          <div className="rfp-piece-panel__body">
            <div className="rfp-piece-panel__status">
              <Tag type={RFP_ITEM_STATUS_TAG_TYPE[item.status]} size="md">
                {RFP_ITEM_STATUS_LABELS[item.status]}
              </Tag>
              <span className="rfp-piece-panel__muted">
                Last update <When at={current && current.createdAt > item.updatedAt ? current.createdAt : item.updatedAt} />
              </span>
            </div>

            <section className="rfp-piece-panel__section" aria-labelledby="rfp-piece-current">
              <h3 id="rfp-piece-current" className="rfp-piece-panel__heading">Current version</h3>
              {current ? (
                <div className="rfp-piece-panel__current">
                  <Tag type="blue" size="sm">v{current.version}</Tag>
                  <div className="rfp-piece-panel__file">
                    <button type="button" className="rfp-response__file-name" onClick={() => onPreview(item, item.documents.length - 1)}>
                      {current.filename}
                    </button>
                    <span className="rfp-piece-panel__muted">
                      {personName(current.uploadedBy)} · <When at={current.createdAt} /> · {formatFileSize(current.size)}
                    </span>
                  </div>
                  <a
                    className="rfp-documents__download"
                    href={rfpsApi.documentUrl(rfpId, current.id)}
                    aria-label={`Download ${current.filename}`}
                    title="Download"
                  >
                    <Download size={16} />
                  </a>
                </div>
              ) : (
                <p className="rfp-piece-panel__muted">Nothing uploaded yet.</p>
              )}
              <div className="rfp-piece-panel__upload">
                {uploading ? (
                  <InlineLoading description="Uploading…" />
                ) : (
                  <FileUploaderButton
                    buttonKind="tertiary"
                    size="sm"
                    labelText={current ? 'Upload a new version' : 'Upload'}
                    accept={PIECE_ACCEPTED}
                    disableLabelChanges
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => upload(e.target.files)}
                  />
                )}
                {current && <span className="rfp-piece-panel__muted">Uploading puts the piece back in progress.</span>}
              </div>
            </section>

            <section className="rfp-piece-panel__section" aria-labelledby="rfp-piece-verification">
              <h3 id="rfp-piece-verification" className="rfp-piece-panel__heading">Verification</h3>
              {verifiers.length === 0 ? (
                <p className="rfp-piece-panel__muted">This RFP has no verifiers. The owner can add them from the page header.</p>
              ) : (
                <ul className="rfp-piece-panel__verifiers" aria-label="Verifiers">
                  {states.map(({ person, state, verification }) => (
                    <li key={person.id} className="rfp-piece-panel__verifier">
                      <PersonAvatar person={person} size="md" />
                      <div className="rfp-piece-panel__verifier-text">
                        <span>
                          {personName(person)}
                          {person.id === currentUserId && <span className="rfp-piece-panel__muted"> (you)</span>}
                        </span>
                        {verification && (
                          <span className="rfp-piece-panel__muted">
                            {verification.decision === 'APPROVED' ? 'Approved' : 'Changes requested'}
                            {` v${item.documents.find((d) => d.id === verification.documentId)?.version ?? '?'} · `}
                            <When at={verification.updatedAt} />
                          </span>
                        )}
                        {verification?.comment && <p className="rfp-piece-panel__comment">{verification.comment}</p>}
                      </div>
                      <Tag type={STATE_TAG[state]} size="sm">
                        {VERIFICATION_STATE_LABELS[state]}
                      </Tag>
                    </li>
                  ))}
                </ul>
              )}

              {mine && current && (
                <div className="rfp-piece-panel__decide">
                  {requesting ? (
                    <>
                      <TextArea
                        id="rfp-piece-changes"
                        labelText={`What needs to change in v${current.version}?`}
                        placeholder="Attestation expirée — joindre celle de 2026"
                        rows={3}
                        value={comment}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setComment(e.target.value)}
                      />
                      <div className="rfp-piece-panel__buttons">
                        <Button size="sm" kind="danger" disabled={busy || !comment.trim()} onClick={() => decide('CHANGES_REQUESTED')}>
                          Request changes
                        </Button>
                        <Button size="sm" kind="ghost" onClick={() => setRequesting(false)}>
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="rfp-piece-panel__buttons">
                      <Button size="sm" renderIcon={Checkmark} disabled={busy || mine.state === 'approved'} onClick={() => decide('APPROVED')}>
                        Approve v{current.version}
                      </Button>
                      <Button size="sm" kind="tertiary" renderIcon={Edit} disabled={busy} onClick={() => setRequesting(true)}>
                        Request changes
                      </Button>
                      {mine.verification && (
                        <Button size="sm" kind="ghost" renderIcon={Undo} disabled={busy} onClick={withdraw}>
                          Withdraw my decision
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            {item.documents.length > 0 && (
              <section className="rfp-piece-panel__section" aria-labelledby="rfp-piece-versions">
                <h3 id="rfp-piece-versions" className="rfp-piece-panel__heading">Versions ({item.documents.length})</h3>
                <ul className="rfp-piece-panel__versions" aria-label="Versions">
                  {versionsNewestFirst.map((doc) => (
                    <li key={doc.id} className="rfp-piece-panel__version">
                      <Tag type={doc.id === current?.id ? 'blue' : 'gray'} size="sm">v{doc.version}</Tag>
                      <div className="rfp-piece-panel__file">
                        <button
                          type="button"
                          className="rfp-response__file-name"
                          onClick={() => onPreview(item, item.documents.findIndex((d) => d.id === doc.id))}
                        >
                          {doc.filename}
                        </button>
                        <span className="rfp-piece-panel__muted">
                          {personName(doc.uploadedBy)} · <When at={doc.createdAt} />
                        </span>
                      </div>
                      <Button
                        kind="ghost"
                        size="sm"
                        hasIconOnly
                        renderIcon={TrashCan}
                        iconDescription={`Delete v${doc.version}`}
                        onClick={() => setDeleteVersion(doc)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </SidePanel>

      {createPortal(
        <ConfirmDeleteModal
          open={deleteVersion !== null}
          title={deleteVersion ? `v${deleteVersion.version} — ${deleteVersion.filename}` : ''}
          entityLabel="version"
          consequence={
            deleteVersion && deleteVersion.id === current?.id && item && item.documents.length > 1
              ? 'The previous version becomes the current one again, with the decisions made on it.'
              : undefined
          }
          onConfirm={removeVersion}
          onClose={() => setDeleteVersion(null)}
        />,
        document.body,
      )}
    </>
  );
}
