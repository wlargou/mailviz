import { Modal, Button } from '@carbon/react';
import { Download } from '@carbon/icons-react';
import { emailsApi } from '../../api/emails';
import { getFileTypeInfo, formatFileSize } from '../../utils/fileTypes';
import type { EmailAttachment } from '../../types/email';

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
    a.download = attachment.filename;
    a.click();
  };

  const renderPreview = () => {
    if (fileInfo.category === 'image') {
      return (
        <div className="attachment-preview__image">
          <img src={inlineUrl} alt={attachment.filename} />
        </div>
      );
    }

    if (fileInfo.category === 'pdf') {
      return (
        <div className="attachment-preview__pdf">
          <iframe src={inlineUrl} title={attachment.filename} />
        </div>
      );
    }

    // Non-previewable: show file info + download prompt
    const Icon = fileInfo.icon;
    return (
      <div className="attachment-preview__fallback">
        <Icon size={48} />
        <p className="attachment-preview__filename">{attachment.filename}</p>
        <p className="attachment-preview__meta">
          {fileInfo.label} · {formatFileSize(attachment.size)}
        </p>
        <p className="attachment-preview__hint">
          This file type cannot be previewed. Download to open it.
        </p>
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onRequestClose={onClose}
      modalHeading={attachment.filename}
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
    </Modal>
  );
}
