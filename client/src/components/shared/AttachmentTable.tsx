import { useState } from 'react';
import {
  DataTable,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  Button,
} from '@carbon/react';
import { Download } from '@carbon/icons-react';
import { format } from 'date-fns';
import { AttachmentPreviewModal } from '../mail/AttachmentPreviewModal';
import { EmptyState } from './EmptyState';
import { emailsApi } from '../../api/emails';
import { getFileTypeInfo, formatFileSize } from '../../utils/fileTypes';
import type { AttachmentWithEmail } from '../../types/email';

interface AttachmentTableProps {
  attachments: AttachmentWithEmail[];
  emptyDescription?: string;
}

const headers = [
  { key: 'filename', header: 'File' },
  { key: 'type', header: 'Type' },
  { key: 'size', header: 'Size' },
  { key: 'emailSubject', header: 'Email' },
  { key: 'date', header: 'Date' },
  { key: 'actions', header: '' },
];

export function AttachmentTable({ attachments, emptyDescription = 'No attachments found' }: AttachmentTableProps) {
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentWithEmail | null>(null);

  if (attachments.length === 0) {
    return <EmptyState title="No attachments" description={emptyDescription} />;
  }

  const rows = attachments.map((a) => {
    const info = getFileTypeInfo(a.mimeType, a.filename);
    return {
      id: a.id,
      filename: a.filename,
      type: info.label,
      size: formatFileSize(a.size),
      emailSubject: a.email.subject,
      date: format(new Date(a.email.receivedAt), 'MMM d, yyyy'),
    };
  });

  const handleDownload = (a: AttachmentWithEmail) => {
    const link = document.createElement('a');
    link.href = emailsApi.getAttachmentUrl(a.emailId, a.id);
    link.download = a.filename;
    link.click();
  };

  return (
    <>
      <DataTable rows={rows} headers={headers}>
        {({ rows: tableRows, headers: tableHeaders, getTableProps, getHeaderProps, getRowProps }) => (
          <TableContainer>
            <Table {...getTableProps()} size="lg">
              <TableHead>
                <TableRow>
                  {tableHeaders.map((header) => (
                    <TableHeader {...getHeaderProps({ header })} key={header.key}>
                      {header.header}
                    </TableHeader>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {tableRows.map((row) => {
                  const attachment = attachments.find((a) => a.id === row.id)!;
                  const info = getFileTypeInfo(attachment.mimeType, attachment.filename);
                  const Icon = info.icon;
                  return (
                    <TableRow {...getRowProps({ row })} key={row.id}>
                      <TableCell>
                        <span
                          className="attachment-table__filename"
                          onClick={() => setPreviewAttachment(attachment)}
                        >
                          <Icon size={16} />
                          {attachment.filename}
                        </span>
                      </TableCell>
                      <TableCell>{info.label}</TableCell>
                      <TableCell>{formatFileSize(attachment.size)}</TableCell>
                      <TableCell>{attachment.email.subject}</TableCell>
                      <TableCell>{format(new Date(attachment.email.receivedAt), 'MMM d, yyyy')}</TableCell>
                      <TableCell>
                        <Button
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          iconDescription="Download"
                          renderIcon={Download}
                          onClick={() => handleDownload(attachment)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DataTable>

      <AttachmentPreviewModal
        open={!!previewAttachment}
        attachment={previewAttachment ? {
          id: previewAttachment.id,
          emailId: previewAttachment.emailId,
          gmailAttachmentId: previewAttachment.gmailAttachmentId,
          filename: previewAttachment.filename,
          mimeType: previewAttachment.mimeType,
          size: previewAttachment.size,
        } : null}
        emailId={previewAttachment?.emailId || ''}
        onClose={() => setPreviewAttachment(null)}
      />
    </>
  );
}
