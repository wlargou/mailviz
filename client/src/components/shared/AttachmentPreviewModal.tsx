import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Modal, Button, IconButton } from '@carbon/react';
import { Download, ChevronLeft, ChevronRight } from '@carbon/icons-react';
import { getFileTypeInfo, formatFileSize } from '../../utils/fileTypes';
import { decodeEntities } from '../../utils/text';
import { SpreadsheetPreview } from './SpreadsheetPreview';

/** Past this the whole file would be parsed in the tab; the download is the better tool. */
const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;

/** Everything the preview needs to know about a file, whatever holds it. */
export interface PreviewableFile {
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * One file and where its bytes are.
 *
 * The URLs come from the caller because only the caller knows whether the
 * bytes are a Gmail attachment streamed on demand or an RFP document on the
 * volume — the preview is the same either way.
 */
export interface PreviewItem {
  file: PreviewableFile;
  /** Served `Content-Disposition: inline` — what the frame and img read. */
  inlineUrl: string;
  /** Served as an attachment — what Download saves. */
  downloadUrl: string;
}

interface AttachmentPreviewModalProps {
  /** Everything openable from where the preview was launched. */
  items: PreviewItem[];
  /** Which one is showing. Out of range closes nothing — it renders nothing. */
  index: number;
  onIndexChange: (index: number) => void;
  open: boolean;
  onClose: () => void;
}

/**
 * One preview for every file the app holds: mail attachments, a company's
 * documents, a tender dossier.
 *
 * It takes the whole set rather than one file so that a dossier of five
 * documents can be read without closing and reopening between each — the
 * arrows and the ← → keys step through them, and the frame gets nearly the
 * whole window, because these are 40-page tenders and multi-sheet costings.
 */
export function AttachmentPreviewModal({ items, index, onIndexChange, open, onClose }: AttachmentPreviewModalProps) {
  const current = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  const step = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < items.length) onIndexChange(next);
    },
    [index, items.length, onIndexChange]
  );

  // ← and → step through the set, except where the arrows already mean
  // something to whatever has focus:
  //
  //  - a text field, so typing cannot navigate away from the document;
  //  - a tablist, because a spreadsheet's sheet tabs are Carbon's and the
  //    arrows move between sheets there. Stepping documents from inside the
  //    sheet tabs was the confusing half of this: the key appeared dead.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (el instanceof HTMLElement && (el.isContentEditable || el.closest('[role="tablist"]'))) return;
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step]);

  if (!current) return null;

  const { file, inlineUrl, downloadUrl } = current;
  const fileInfo = getFileTypeInfo(file.mimeType, file.filename);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = decodeEntities(file.filename);
    a.click();
  };

  const renderPreview = () => {
    if (fileInfo.category === 'image') {
      return (
        <div className="attachment-preview__image">
          <img src={inlineUrl} alt={decodeEntities(file.filename)} />
        </div>
      );
    }

    // PDF and plain text both render in a frame — the browser draws either
    // from the inline URL. Plain text was marked previewable with no branch
    // here, so it landed on the "cannot be previewed" message below inside a
    // passive modal that offered no way to download it.
    if (fileInfo.category === 'pdf' || (fileInfo.previewable && fileInfo.category === 'document')) {
      return (
        <div className="attachment-preview__pdf">
          {/* Keyed on the URL so stepping to the next document replaces the
              frame rather than asking the viewer to re-navigate inside it. */}
          <iframe key={inlineUrl} src={inlineUrl} title={decodeEntities(file.filename)} />
        </div>
      );
    }

    if (fileInfo.category === 'spreadsheet' && file.size <= MAX_SPREADSHEET_BYTES) {
      return <SpreadsheetPreview url={inlineUrl} />;
    }

    // Non-previewable, or too big to parse in the tab: file info + download prompt
    const Icon = fileInfo.icon;
    return (
      <div className="attachment-preview__fallback">
        <Icon size={48} />
        <p className="attachment-preview__filename">{decodeEntities(file.filename)}</p>
        <p className="attachment-preview__meta">
          {fileInfo.label} · {formatFileSize(file.size)}
        </p>
        <p className="attachment-preview__hint">
          {fileInfo.category === 'spreadsheet'
            ? 'Too large to preview here. Download to open it.'
            : 'This file type cannot be previewed. Download to open it.'}
        </p>
      </div>
    );
  };

  // Portaled: the thread renders inside a Carbon SidePanel, and a
  // `position: fixed` modal inside a fixed, transformed panel resolves
  // against the panel, not the viewport — the dialog opened offset to the
  // right with its Download button past the edge of the screen.
  return createPortal(
    <Modal
      open={open}
      onRequestClose={onClose}
      modalHeading={decodeEntities(file.filename)}
      modalLabel={items.length > 1 ? `Document ${index + 1} of ${items.length}` : undefined}
      passiveModal={fileInfo.previewable}
      primaryButtonText={fileInfo.previewable ? undefined : 'Download'}
      secondaryButtonText={fileInfo.previewable ? undefined : 'Cancel'}
      onRequestSubmit={fileInfo.previewable ? undefined : handleDownload}
      size="lg"
      className="attachment-preview-modal"
    >
      <div className="attachment-preview">
        <div className="attachment-preview__stage">
          {items.length > 1 && (
            <IconButton
              label="Previous document"
              kind="ghost"
              size="lg"
              disabled={!hasPrev}
              onClick={() => step(-1)}
              className="attachment-preview__nav attachment-preview__nav--prev"
            >
              <ChevronLeft size={24} />
            </IconButton>
          )}
          <div className="attachment-preview__body">{renderPreview()}</div>
          {items.length > 1 && (
            <IconButton
              label="Next document"
              kind="ghost"
              size="lg"
              disabled={!hasNext}
              onClick={() => step(1)}
              className="attachment-preview__nav attachment-preview__nav--next"
            >
              <ChevronRight size={24} />
            </IconButton>
          )}
        </div>
        {fileInfo.previewable && (
          <div className="attachment-preview__actions">
            <Button kind="tertiary" size="sm" renderIcon={Download} onClick={handleDownload}>
              Download ({formatFileSize(file.size)})
            </Button>
          </div>
        )}
      </div>
    </Modal>,
    document.body,
  );
}
