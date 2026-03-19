import { useState, useMemo } from 'react';
import {
  DataTable,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Pagination,
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
  { key: 'sizeRaw', header: 'Size' },
  { key: 'emailSubject', header: 'Email' },
  { key: 'dateRaw', header: 'Date' },
  { key: 'actions', header: '' },
];

export function AttachmentTable({ attachments, emptyDescription = 'No attachments found' }: AttachmentTableProps) {
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentWithEmail | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortKey, setSortKey] = useState<string>('dateRaw');
  const [sortDirection, setSortDirection] = useState<'ASC' | 'DESC' | 'NONE'>('DESC');

  // Filter by search term
  const filtered = useMemo(() => {
    if (!searchTerm) return attachments;
    const q = searchTerm.toLowerCase();
    return attachments.filter((a) =>
      a.filename.toLowerCase().includes(q) ||
      a.email.subject.toLowerCase().includes(q) ||
      a.mimeType.toLowerCase().includes(q)
    );
  }, [attachments, searchTerm]);

  // Sort
  const sorted = useMemo(() => {
    if (sortDirection === 'NONE') return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'filename':
          cmp = a.filename.localeCompare(b.filename);
          break;
        case 'type': {
          const ta = getFileTypeInfo(a.mimeType, a.filename).label;
          const tb = getFileTypeInfo(b.mimeType, b.filename).label;
          cmp = ta.localeCompare(tb);
          break;
        }
        case 'sizeRaw':
          cmp = a.size - b.size;
          break;
        case 'emailSubject':
          cmp = a.email.subject.localeCompare(b.email.subject);
          break;
        case 'dateRaw':
          cmp = new Date(a.email.receivedAt).getTime() - new Date(b.email.receivedAt).getTime();
          break;
      }
      return sortDirection === 'DESC' ? -cmp : cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDirection]);

  // Paginate
  const totalItems = sorted.length;
  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  if (attachments.length === 0) {
    return <EmptyState title="No attachments" description={emptyDescription} />;
  }

  const rows = paginated.map((a) => {
    const info = getFileTypeInfo(a.mimeType, a.filename);
    return {
      id: a.id,
      filename: a.filename,
      type: info.label,
      sizeRaw: String(a.size),
      emailSubject: a.email.subject,
      dateRaw: a.email.receivedAt,
    };
  });

  const handleDownload = (a: AttachmentWithEmail) => {
    const link = document.createElement('a');
    link.href = emailsApi.getAttachmentUrl(a.emailId, a.id);
    link.download = a.filename;
    link.click();
  };

  const handleSort = (headerKey: string) => {
    if (headerKey === 'actions') return;
    if (sortKey === headerKey) {
      setSortDirection((prev) => prev === 'ASC' ? 'DESC' : prev === 'DESC' ? 'NONE' : 'ASC');
    } else {
      setSortKey(headerKey);
      setSortDirection('ASC');
    }
  };

  return (
    <>
      <DataTable rows={rows} headers={headers} isSortable>
        {({ rows: tableRows, headers: tableHeaders, getTableProps, getHeaderProps, getRowProps }) => (
          <TableContainer>
            <TableToolbar>
              <TableToolbarContent>
                <TableToolbarSearch
                  placeholder="Search attachments..."
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                  }}
                  persistent
                />
              </TableToolbarContent>
            </TableToolbar>
            <Table {...getTableProps()} size="lg">
              <TableHead>
                <TableRow>
                  {tableHeaders.map((header) => (
                    <TableHeader
                      {...getHeaderProps({ header })}
                      key={header.key}
                      isSortable={header.key !== 'actions'}
                      isSortHeader={sortKey === header.key}
                      sortDirection={sortKey === header.key ? sortDirection : 'NONE'}
                      onClick={() => handleSort(header.key)}
                    >
                      {header.header}
                    </TableHeader>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {paginated.map((attachment, idx) => {
                  const info = getFileTypeInfo(attachment.mimeType, attachment.filename);
                  const Icon = info.icon;
                  const row = tableRows[idx];
                  if (!row) return null;
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

      {totalItems > 10 && (
        <Pagination
          totalItems={totalItems}
          pageSize={pageSize}
          pageSizes={[10, 20, 50, 100]}
          page={page}
          onChange={({ page: p, pageSize: ps }: { page: number; pageSize: number }) => {
            setPage(p);
            setPageSize(ps);
          }}
        />
      )}

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
