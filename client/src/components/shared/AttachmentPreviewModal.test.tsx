import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentPreviewModal } from './AttachmentPreviewModal';

vi.mock('./SpreadsheetPreview', () => ({
  SpreadsheetPreview: ({ url }: { url: string }) => (
    <div data-testid="spreadsheet-preview">
      {url}
      {/* Stands in for Carbon's sheet tabs, which own the arrow keys. */}
      <div role="tablist"><button type="button" role="tab" data-testid="sheet-tab">Sheet1</button></div>
    </div>
  ),
}));
import type { PreviewableFile } from './AttachmentPreviewModal';

/**
 * What the preview shows for each kind of file. The gate is
 * `getFileTypeInfo(...).previewable`, but a previewable type still needs a
 * branch that draws it — plain text had the flag and no branch, so it fell
 * through to the "cannot be previewed" message inside a passive modal with
 * no download button.
 */
function attachment(overrides: Partial<PreviewableFile>): PreviewableFile {
  return { filename: 'file', mimeType: 'application/octet-stream', size: 1024, ...overrides };
}

const INLINE = '/api/v1/emails/e1/attachments/att-1?inline=true';

function item(att: PreviewableFile, n = 1) {
  return { file: att, inlineUrl: `/inline/${n}`, downloadUrl: `/download/${n}` };
}

function renderModal(att: PreviewableFile) {
  return render(
    <AttachmentPreviewModal
      open
      items={[{ file: att, inlineUrl: INLINE, downloadUrl: '/api/v1/emails/e1/attachments/att-1' }]}
      index={0}
      onIndexChange={vi.fn()}
      onClose={vi.fn()}
    />
  );
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

/**
 * A dossier is read front to back — an RC, then the CPS, then the Avis and
 * the annexes. Before this the set had to be closed and reopened between
 * each, so the arrows and the ← → keys step through it in place.
 */
describe('AttachmentPreviewModal — stepping through a set', () => {
  const pdf = (n: number) => ({ filename: `doc-${n}.pdf`, mimeType: 'application/pdf', size: 1000 });

  function renderSet(index: number, onIndexChange = vi.fn()) {
    const items = [item(pdf(1), 1), item(pdf(2), 2), item(pdf(3), 3)];
    render(<AttachmentPreviewModal open items={items} index={index} onIndexChange={onIndexChange} onClose={vi.fn()} />);
    return onIndexChange;
  }

  it('says where you are and moves in both directions', async () => {
    const user = userEvent.setup();
    const onIndexChange = renderSet(1);

    expect(screen.getByText('Document 2 of 3')).toBeInTheDocument();
    expect(screen.getByTitle('doc-2.pdf')).toHaveAttribute('src', '/inline/2');

    await user.click(screen.getByRole('button', { name: 'Next document' }));
    expect(onIndexChange).toHaveBeenLastCalledWith(2);

    await user.click(screen.getByRole('button', { name: 'Previous document' }));
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
  });

  it('stops at both ends rather than wrapping', async () => {
    const user = userEvent.setup();
    const first = renderSet(0);
    expect(screen.getByRole('button', { name: 'Previous document' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next document' }));
    expect(first).toHaveBeenLastCalledWith(1);

    cleanup();
    const last = renderSet(2);
    expect(screen.getByRole('button', { name: 'Next document' })).toBeDisabled();
    expect(last).not.toHaveBeenCalled();
  });

  it('steps with the arrow keys', async () => {
    const user = userEvent.setup();
    const onIndexChange = renderSet(1);

    await user.keyboard('{ArrowRight}');
    expect(onIndexChange).toHaveBeenLastCalledWith(2);

    await user.keyboard('{ArrowLeft}');
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
  });

  it('leaves the arrows to the sheet tabs inside a spreadsheet preview', async () => {
    // A spreadsheet's sheet tabs are a Carbon tablist where ← → move between
    // sheets. Stepping documents from in there made the key look dead. The
    // tablist has to be INSIDE the dialog to be reachable at all — Carbon's
    // focus wrap pulls focus back in from anywhere else.
    const user = userEvent.setup();
    const onIndexChange = vi.fn();
    const xlsx = { filename: 'costing.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 2048 };
    render(
      <AttachmentPreviewModal
        open
        items={[{ file: xlsx, inlineUrl: '/inline/1', downloadUrl: '/download/1' }, item(pdf(2), 2)]}
        index={0}
        onIndexChange={onIndexChange}
        onClose={vi.fn()}
      />
    );

    const tab = await screen.findByTestId('sheet-tab');
    tab.focus();
    expect(document.activeElement).toBe(tab);

    await user.keyboard('{ArrowRight}');
    expect(onIndexChange).not.toHaveBeenCalled();

    // Focus anywhere else in the dialog and the set steps again.
    screen.getByRole('button', { name: 'Next document' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it('offers no arrows, and no counter, for a single file', () => {
    render(<AttachmentPreviewModal open items={[item(pdf(1))]} index={0} onIndexChange={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /document$/ })).toBeNull();
    expect(screen.queryByText(/Document 1 of/)).toBeNull();
  });

  it('renders nothing when the index points past the set', () => {
    // A document deleted while its preview was open, rather than a crash.
    const { container } = render(<AttachmentPreviewModal open items={[]} index={0} onIndexChange={vi.fn()} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
