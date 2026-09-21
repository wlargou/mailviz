import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttachmentPreviewModal } from './AttachmentPreviewModal';

vi.mock('./SpreadsheetPreview', () => ({ SpreadsheetPreview: ({ url }: { url: string }) => <div data-testid="spreadsheet-preview">{url}</div> }));
import type { EmailAttachment } from '../../types/email';

/**
 * What the preview shows for each kind of file. The gate is
 * `getFileTypeInfo(...).previewable`, but a previewable type still needs a
 * branch that draws it — plain text had the flag and no branch, so it fell
 * through to the "cannot be previewed" message inside a passive modal with
 * no download button.
 */
function attachment(overrides: Partial<EmailAttachment>): EmailAttachment {
  return { id: 'att-1', emailId: 'e1', gmailAttachmentId: 'g1', filename: 'file', mimeType: 'application/octet-stream', size: 1024, ...overrides };
}

function renderModal(att: EmailAttachment) {
  return render(<AttachmentPreviewModal open attachment={att} emailId="e1" onClose={vi.fn()} />);
}

describe('AttachmentPreviewModal', () => {
  it('frames a PDF from the inline URL', () => {
    renderModal(attachment({ filename: 'quote.pdf', mimeType: 'application/pdf' }));

    expect(screen.getByTitle('quote.pdf')).toHaveAttribute('src', '/api/v1/emails/e1/attachments/att-1?inline=true');
    expect(screen.queryByText(/cannot be previewed/)).toBeNull();
  });

  it('frames plain text too — it was flagged previewable with nothing to draw it', () => {
    renderModal(attachment({ filename: 'notes.txt', mimeType: 'text/plain' }));

    expect(screen.getByTitle('notes.txt')).toHaveAttribute('src', '/api/v1/emails/e1/attachments/att-1?inline=true');
    expect(screen.queryByText(/cannot be previewed/)).toBeNull();
  });

  it('renders a spreadsheet in the tab, from the inline URL', () => {
    renderModal(attachment({ filename: 'sizing.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));

    expect(screen.getByTestId('spreadsheet-preview')).toHaveTextContent('/api/v1/emails/e1/attachments/att-1?inline=true');
    expect(screen.queryByText(/cannot be previewed/)).toBeNull();
  });

  it('sends a spreadsheet past 10 MB to the download instead of parsing it in the tab', () => {
    renderModal(attachment({ filename: 'export.xlsx', mimeType: 'application/vnd.ms-excel', size: 10 * 1024 * 1024 + 1 }));

    expect(screen.queryByTestId('spreadsheet-preview')).toBeNull();
    expect(screen.getByText(/Too large to preview/)).toBeInTheDocument();
  });

  it('offers a download for a file it cannot render', () => {
    renderModal(attachment({ filename: 'Proposal.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));

    expect(screen.getByText(/cannot be previewed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByTitle('Proposal.docx')).toBeNull();
  });
});
