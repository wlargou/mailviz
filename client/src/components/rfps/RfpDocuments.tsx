import { useState } from 'react';
import { Dropdown, FileUploaderButton, Button, Tag, InlineLoading } from '@carbon/react';
import { Download, TrashCan } from '@carbon/icons-react';
import { rfpsApi } from '../../api/rfps';
import { AttachmentPreviewModal } from '../shared/AttachmentPreviewModal';
import { formatFileSize, getFileTypeInfo } from '../../utils/fileTypes';
import { RFP_DOCUMENT_KINDS, RFP_DOCUMENT_KIND_LABELS, type RfpDocument, type RfpDocumentKind } from '../../types/rfp';

/** A file chosen before the tender exists, waiting for the create to succeed. */
export interface PendingDocument {
  file: File;
  kind: RfpDocumentKind;
}

const kindItems = RFP_DOCUMENT_KINDS.map((id) => ({ id, text: RFP_DOCUMENT_KIND_LABELS[id] }));

/** Mirrors the server's whitelist in `services/rfpStorage.ts`. */
const ACCEPTED = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.txt', '.csv', '.png', '.jpg', '.jpeg'];

interface RfpDocumentsProps {
  /** Absent while creating: files are held as `pending` until the tender exists. */
  rfpId?: string;
  documents: RfpDocument[];
  pending: PendingDocument[];
  onPendingChange: (pending: PendingDocument[]) => void;
  /** Re-read the tender after an upload or a delete that already happened. */
  onUploaded: () => void;
}

/**
 * The tender dossier: the RC, the CPS, the Avis, the annexes.
 *
 * `kind` is picked before the file rather than after, because one PDF can be
 * two documents — Tanger Med ships the RC and the CPS as a single file where
 * BKAM and the DGI split them — so the label is a judgement the user makes,
 * not something the filename decides.
 */
export function RfpDocuments({ rfpId, documents, pending, onPendingChange, onUploaded }: RfpDocumentsProps) {
  const [kind, setKind] = useState<RfpDocumentKind>('RFP');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The whole dossier, so the arrows step RC → CPS → Avis → annexes.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const chosen = Array.from(files);
    setError(null);
    if (!rfpId) {
      onPendingChange([...pending, ...chosen.map((file) => ({ file, kind }))]);
      return;
    }
    setBusy(true);
    try {
      for (const file of chosen) {
        await rfpsApi.uploadDocument(rfpId, file, kind);
      }
      onUploaded();
    } catch {
      setError('Upload failed. Check the file type and that it is under 25 MB.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!rfpId) return;
    setBusy(true);
    try {
      await rfpsApi.deleteDocument(rfpId, documentId);
      onUploaded();
    } catch {
      setError('Could not remove the document.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rfp-documents">
      <div className="rfp-documents__controls">
        <Dropdown
          id="rfp-document-kind"
          titleText="Document type"
          label="Select type"
          items={kindItems}
          itemToString={(item) => item?.text || ''}
          selectedItem={kindItems.find((k) => k.id === kind) ?? null}
          onChange={({ selectedItem }) => {
            if (selectedItem) setKind(selectedItem.id);
          }}
          size="sm"
        />
        <FileUploaderButton
          labelText="Add file"
          buttonKind="tertiary"
          size="sm"
          accept={ACCEPTED}
          multiple
          disableLabelChanges
          disabled={busy}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            handleFiles(e.target.files);
            // Clear it, so choosing the same file twice fires onChange again.
            e.target.value = '';
          }}
        />
      </div>

      {busy && <InlineLoading description="Uploading…" />}
      {error && <p className="rfp-documents__error">{error}</p>}

      {documents.length === 0 && pending.length === 0 && !busy && (
        <p className="rfp-documents__empty">No documents yet — add the RC, the CPS, the Avis and any annexes.</p>
      )}

      <ul className="rfp-documents__list">
        {documents.map((doc, i) => {
          const Icon = getFileTypeInfo(doc.mimeType, doc.filename).icon;
          return (
            <li key={doc.id} className="rfp-documents__item">
              <Icon size={16} />
              <Tag type="cool-gray" size="sm">{RFP_DOCUMENT_KIND_LABELS[doc.kind]}</Tag>
              {/* Opens the preview, as every other attachment in the app does
                  — a tender dossier is PDFs and spreadsheets, which is
                  exactly what it renders. Download stays on the icon. */}
              <button type="button" className="rfp-documents__name" onClick={() => setPreviewIndex(i)}>
                {doc.filename}
              </button>
              <span className="rfp-documents__size">{formatFileSize(doc.size)}</span>
              <a
                className="rfp-documents__download"
                href={rfpsApi.documentUrl(doc.rfpId, doc.id)}
                download={doc.filename}
                title="Download"
              >
                <Download size={16} />
              </a>
              <Button
                kind="ghost"
                size="sm"
                hasIconOnly
                renderIcon={TrashCan}
                iconDescription={`Remove ${doc.filename}`}
                disabled={busy}
                onClick={() => handleDelete(doc.id)}
              />
            </li>
          );
        })}

        {pending.map((p, i) => (
          <li key={`pending-${i}`} className="rfp-documents__item rfp-documents__item--pending">
            <Tag type="cool-gray" size="sm">{RFP_DOCUMENT_KIND_LABELS[p.kind]}</Tag>
            <span className="rfp-documents__name">{p.file.name}</span>
            <span className="rfp-documents__size">{formatFileSize(p.file.size)}</span>
            <span className="rfp-documents__pending-hint">Uploads when saved</span>
            <Button
              kind="ghost"
              size="sm"
              hasIconOnly
              renderIcon={TrashCan}
              iconDescription={`Remove ${p.file.name}`}
              onClick={() => onPendingChange(pending.filter((_, j) => j !== i))}
            />
          </li>
        ))}
      </ul>

      <AttachmentPreviewModal
        open={previewIndex !== null}
        items={documents.map((d) => ({
          file: d,
          inlineUrl: rfpsApi.documentInlineUrl(d.rfpId, d.id),
          downloadUrl: rfpsApi.documentUrl(d.rfpId, d.id),
        }))}
        index={previewIndex ?? 0}
        onIndexChange={setPreviewIndex}
        onClose={() => setPreviewIndex(null)}
      />
    </div>
  );
}
