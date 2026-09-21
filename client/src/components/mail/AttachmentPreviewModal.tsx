import { createPortal } from 'react-dom';
import { Modal, Button } from '@carbon/react';
import { Download } from '@carbon/icons-react';
import { emailsApi } from '../../api/emails';
import { getFileTypeInfo, formatFileSize } from '../../utils/fileTypes';
import type { EmailAttachment } from '../../types/email';
import { decodeEntities } from '../../utils/text';
import { SpreadsheetPreview } from './SpreadsheetPreview';

/** Past this the whole file would be parsed in the tab; the download is the better tool. */
const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;

interface AttachmentPreviewModalProps {
  attachment: EmailAttachment | null;
  emailId: string;
  open: boolean;
  onClose: () => void;
}

export function AttachmentPreviewModal({ attachment, emailId, open, onClose }: AttachmentPreviewModalProps) {
  if (!attachment) return null;

  const fileInfo = getFileTypeInfo(attachment.mimeType, attachment.filename);
  const inlineUrl = emailsApi.getAttachmentInlineUrl(emailId, attachment.id);
  const downloadUrl = emailsApi.getAttachmentUrl(emailId, attachment.id);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = decodeEntities(attachment.filename);
    a.click();
  };

  const renderPreview = () => {
    if (fileInfo.category === 'image') {
      return (
        <div className="attachment-preview__image">
          <img src={inlineUrl} alt={decodeEntities(attachment.filename)} />
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
          <iframe src={inlineUrl} title={decodeEntities(attachment.filename)} />
        </div>
      );
    }

    if (fileInfo.category === 'spreadsheet' && attachment.size <= MAX_SPREADSHEET_BYTES) {
      return <SpreadsheetPreview url={inlineUrl} />;
    }

    // Non-previewable, or too big to parse in the tab: file info + download prompt
    const Icon = fileInfo.icon;
    return (
      <div className="attachment-preview__fallback">
        <Icon size={48} />
        <p className="attachment-preview__filename">{decodeEntities(attachment.filename)}</p>
        <p className="attachment-preview__meta">
          {fileInfo.label} · {formatFileSize(attachment.size)}
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
      modalHeading={decodeEntities(attachment.filename)}
      passiveModal={fileInfo.previewable}
      primaryButtonText={fileInfo.previewable ? undefined : 'Download'}
      secondaryButtonText={fileInfo.previewable ? undefined : 'Cancel'}
      onRequestSubmit={fileInfo.previewable ? undefined : handleDownload}
      size="lg"
    >
      <div className="attachment-preview">
        {renderPreview()}
        {fileInfo.previewable && (
          <div className="attachment-preview__actions">
            <Button kind="tertiary" size="sm" renderIcon={Download} onClick={handleDownload}>
              Download ({formatFileSize(attachment.size)})
            </Button>
          </div>
        )}
      </div>
    </Modal>,
    document.body,
  );
}
