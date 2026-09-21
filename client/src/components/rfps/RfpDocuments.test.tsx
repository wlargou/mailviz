import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RfpDocuments } from './RfpDocuments';
import type { RfpDocument } from '../../types/rfp';

vi.mock('../../api/rfps', () => ({
  rfpsApi: {
    uploadDocument: vi.fn(),
    deleteDocument: vi.fn(),
    documentUrl: (r: string, d: string) => `/api/v1/rfps/${r}/documents/${d}`,
    documentInlineUrl: (r: string, d: string) => `/api/v1/rfps/${r}/documents/${d}?inline=true`,
  },
}));

vi.mock('../shared/AttachmentPreviewModal', () => ({
  AttachmentPreviewModal: ({ open, items, index }: { open: boolean; items: Array<{ file: { filename: string }; inlineUrl: string; downloadUrl: string }>; index: number }) =>
    open && items[index] ? (
      <div data-testid="preview">
        <span data-testid="preview-name">{items[index].file.filename}</span>
        <span data-testid="preview-inline">{items[index].inlineUrl}</span>
        <span data-testid="preview-download">{items[index].downloadUrl}</span>
        <span data-testid="preview-count">{items.length}</span>
      </div>
    ) : null,
}));

function doc(overrides: Partial<RfpDocument> = {}): RfpDocument {
  return { id: 'd1', rfpId: 'r1', kind: 'RFP', filename: 'CPS AO 70.pdf', mimeType: 'application/pdf', size: 1295231, createdAt: '', ...overrides };
}

/**
 * A tender dossier is PDFs and spreadsheets — exactly what the shared
 * preview renders. Clicking a document opens it, as clicking an attachment
 * does everywhere else in the app; the download stays on its own icon.
 */
describe('RfpDocuments', () => {
  it('opens the preview on the document name, from the inline URL', async () => {
    const user = userEvent.setup();
    render(<RfpDocuments rfpId="r1" documents={[doc()]} pending={[]} onPendingChange={vi.fn()} onUploaded={vi.fn()} />);

    expect(screen.queryByTestId('preview')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'CPS AO 70.pdf' }));

    expect(screen.getByTestId('preview-name')).toHaveTextContent('CPS AO 70.pdf');
    // Inline for the frame, attachment for the save — two different URLs.
    expect(screen.getByTestId('preview-inline')).toHaveTextContent('/api/v1/rfps/r1/documents/d1?inline=true');
    expect(screen.getByTestId('preview-download')).toHaveTextContent('/api/v1/rfps/r1/documents/d1');
  });

  it('hands the whole dossier to the preview, opened on the one clicked', async () => {
    // The arrows step through the set, so the preview needs all of it — not
    // just the document that was clicked.
    const user = userEvent.setup();
    const docs = [doc(), doc({ id: 'd2', filename: 'Avis.pdf', kind: 'AVIS' }), doc({ id: 'd3', filename: 'Annexe 1.xlsx', kind: 'ANNEXE' })];
    render(<RfpDocuments rfpId="r1" documents={docs} pending={[]} onPendingChange={vi.fn()} onUploaded={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Avis.pdf' }));

    expect(screen.getByTestId('preview-count')).toHaveTextContent('3');
    expect(screen.getByTestId('preview-name')).toHaveTextContent('Avis.pdf');
    expect(screen.getByTestId('preview-inline')).toHaveTextContent('/api/v1/rfps/r1/documents/d2?inline=true');
  });

  it('keeps an explicit download beside the name', () => {
    render(<RfpDocuments rfpId="r1" documents={[doc()]} pending={[]} onPendingChange={vi.fn()} onUploaded={vi.fn()} />);

    const link = screen.getByTitle('Download');
    expect(link).toHaveAttribute('href', '/api/v1/rfps/r1/documents/d1');
    expect(link).toHaveAttribute('download', 'CPS AO 70.pdf');
  });

  it('offers no preview for a file that has not been uploaded yet', () => {
    // Nothing to fetch: the bytes are still in the browser, and the preview
    // reads them from the server.
    render(
      <RfpDocuments
        documents={[]}
        pending={[{ file: new File(['%PDF'], 'RC.pdf', { type: 'application/pdf' }), kind: 'RFP' }]}
        onPendingChange={vi.fn()}
        onUploaded={vi.fn()}
      />
    );

    expect(screen.getByText('RC.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'RC.pdf' })).toBeNull();
    expect(screen.getByText('Uploads when saved')).toBeInTheDocument();
  });
});
