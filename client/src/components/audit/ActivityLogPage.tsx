import { useEffect, useState, useCallback } from 'react';
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
  Tag,
  Dropdown,
  SkeletonText,
  Modal,
} from '@carbon/react';
import { Activity, Filter } from '@carbon/icons-react';
import { formatDistanceToNow, format } from 'date-fns';
import { auditApi } from '../../api/audit';
import { PageHeader } from '../shared/PageHeader';
import { EmptyState } from '../shared/EmptyState';
import { TableFilterFlyout } from '../shared/TableFilterFlyout';
import { useUIStore } from '../../store/uiStore';
import { toolbarSearchValue } from '../../utils/carbonSearch';
import { decodeEntities } from '../../utils/text';

interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  status: string;
  createdAt: string;
  user: { id: string; email: string; name: string | null };
}

const headers = [
  { key: 'createdAt', header: 'Time' },
  { key: 'action', header: 'Action' },
  { key: 'entityType', header: 'Type' },
  { key: 'summary', header: 'Details' },
  { key: 'status', header: 'Status' },
];

const actionLabels: Record<string, string> = {
  EMAIL_SENT: 'Email Sent',
  EMAIL_REPLY: 'Email Reply',
  EMAIL_FORWARD: 'Email Forward',
  EMAIL_TRASHED: 'Email Trashed',
  EMAIL_UNTRASHED: 'Email Restored',
  EMAIL_ARCHIVED: 'Email Archived',
  EMAIL_UNARCHIVED: 'Email Unarchived',
  EMAIL_MARK_READ: 'Marked Read',
  EMAIL_MARK_UNREAD: 'Marked Unread',
  EMAIL_STARRED: 'Email Starred',
  EMAIL_UNSTARRED: 'Email Unstarred',
  EMAIL_BATCH_TRASH: 'Batch Trash',
  EMAIL_BATCH_ARCHIVE: 'Batch Archive',
  EMAIL_BATCH_MARK_READ: 'Batch Read',
  EMAIL_BATCH_MARK_UNREAD: 'Batch Unread',
  EMAIL_SCHEDULED: 'Email Scheduled',
  EMAIL_SCHEDULE_CANCELLED: 'Schedule Cancelled',
  EMAIL_SCHEDULE_SENT: 'Scheduled Sent',
  EMAIL_SHARED: 'Email Shared',
  EMAIL_UNSHARED: 'Email Unshared',
  EMAIL_CONVERTED_TO_TASK: 'Email → Task',
  EMAIL_ATTACHED_TO_TASK: 'Email Attached to Task',
  EMAIL_DETACHED_FROM_TASK: 'Email Detached from Task',
  TASK_CREATED: 'Task Created',
  TASK_UPDATED: 'Task Updated',
  TASK_DELETED: 'Task Deleted',
  TASK_SHARED: 'Task Shared',
  TASK_ASSIGNED: 'Task Assigned',
  TASK_CHECKLIST_UPDATED: 'Checklist Updated',
  TASK_COMMENTED: 'Task Commented',
  TASK_COMMENT_EDITED: 'Comment Edited',
  TASK_COMMENT_DELETED: 'Comment Deleted',
  TASK_DEPENDENCY_ADDED: 'Dependency Added',
  TASK_DEPENDENCY_REMOVED: 'Dependency Removed',
  TASK_LINK_ADDED: 'Task Linked',
  TASK_LINK_REMOVED: 'Task Unlinked',
  TASK_TIME_LOGGED: 'Time Logged',
  TASK_TIME_DELETED: 'Time Entry Deleted',
  TASK_TEMPLATE_CREATED: 'Task Template Created',
  TASK_TEMPLATE_UPDATED: 'Task Template Updated',
  TASK_TEMPLATE_DELETED: 'Task Template Deleted',
  TASK_TEMPLATE_APPLIED: 'Task Template Applied',
  TASK_BATCH_STATUS: 'Batch Status Change',
  TASK_BATCH_ASSIGNED: 'Batch Assigned',
  TASK_BATCH_LABELLED: 'Batch Labelled',
  TASK_BATCH_DELETED: 'Batch Deleted',
  TASK_VIEW_SAVED: 'Task View Saved',
  TASK_VIEW_DELETED: 'Task View Deleted',
  DEAL_CREATED: 'Deal Created',
  DEAL_UPDATED: 'Deal Updated',
  DEAL_DELETED: 'Deal Deleted',
  DEAL_SHARED: 'Deal Shared',
  EVENT_CREATED: 'Event Created',
  EVENT_UPDATED: 'Event Updated',
  EVENT_DELETED: 'Event Deleted',
  EVENT_RESPONDED: 'Event Response',
  COMPANY_CREATED: 'Company Created',
  COMPANY_UPDATED: 'Company Updated',
  COMPANY_DELETED: 'Company Deleted',
  CONTACT_CREATED: 'Contact Created',
  CONTACT_UPDATED: 'Contact Updated',
  CONTACT_DELETED: 'Contact Deleted',
  GOOGLE_CONNECTED: 'Google Connected',
  GOOGLE_DISCONNECTED: 'Google Disconnected',
  USER_LOGIN: 'Login',
  USER_LOGOUT: 'Logout',
  EMAIL_SCHEDULE_UPDATED: 'Schedule Updated',
  EMAIL_DRAFT_SAVED: 'Draft Saved',
  EMAIL_DRAFT_DELETED: 'Draft Deleted',
  EMAIL_DRAFT_SENT: 'Draft Sent',
  EMAIL_SNOOZED: 'Email Snoozed',
  EMAIL_UNSNOOZED: 'Email Unsnoozed',
  EMAIL_FOLLOW_UP_SET: 'Follow-up Set',
  EMAIL_FOLLOW_UP_CLEARED: 'Follow-up Cleared',
  CONTACT_MERGED: 'Contacts Merged',
  TEMPLATE_CREATED: 'Email Template Created',
  TEMPLATE_UPDATED: 'Email Template Updated',
  TEMPLATE_DELETED: 'Email Template Deleted',
  LABEL_CREATED: 'Label Created',
  LABEL_UPDATED: 'Label Updated',
  LABEL_DELETED: 'Label Deleted',
  ONBOARDING_COMPLETED: 'Setup Completed',
  ONBOARDING_SKIPPED: 'Setup Skipped',
};

const actionColors: Record<string, string> = {
  EMAIL_SENT: 'blue',
  EMAIL_REPLY: 'blue',
  EMAIL_FORWARD: 'blue',
  EMAIL_TRASHED: 'red',
  EMAIL_BATCH_TRASH: 'red',
  EMAIL_ARCHIVED: 'warm-gray',
  EMAIL_BATCH_ARCHIVE: 'warm-gray',
  EMAIL_SCHEDULED: 'teal',
  EMAIL_SHARED: 'purple',
  EMAIL_CONVERTED_TO_TASK: 'cyan',
  TASK_CREATED: 'green',
  TASK_DELETED: 'red',
  DEAL_CREATED: 'green',
  DEAL_DELETED: 'red',
  EVENT_CREATED: 'green',
  EVENT_DELETED: 'red',
  COMPANY_CREATED: 'green',
  COMPANY_DELETED: 'red',
  CONTACT_CREATED: 'green',
  CONTACT_DELETED: 'red',
};

const entityTypeItems = [
  { id: '', text: 'All types' },
  { id: 'email', text: 'Email' },
  { id: 'task', text: 'Task' },
  { id: 'deal', text: 'Deal' },
  { id: 'event', text: 'Event' },
  { id: 'company', text: 'Company' },
  { id: 'contact', text: 'Contact' },
  { id: 'label', text: 'Label' },
  { id: 'scheduled_email', text: 'Scheduled Email' },
];

export function getSummary(entry: AuditLogEntry): string {
  const d = entry.details as Record<string, unknown> | null;
  if (!d) return '—';

  const parts: string[] = [];

  if (d.subject) parts.push(`"${decodeEntities(String(d.subject)).slice(0, 60)}"`);
  if (d.title) parts.push(`"${decodeEntities(String(d.title)).slice(0, 60)}"`);
  if (d.name) parts.push(String(d.name));
  // An email's `to`/`from` are addresses; a task update's are the before and
  // after values keyed by field, which read as "[object Object]" through
  // String(). Those are rendered with the change list below.
  const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (d.to && !isMap(d.to)) {
    const to = Array.isArray(d.to) ? d.to.join(', ') : String(d.to);
    parts.push(`→ ${to.slice(0, 60)}`);
  }
  if (d.from && !isMap(d.from)) parts.push(`from ${String(d.from).slice(0, 40)}`);
  // The 1.12 task actions.
  if (d.blocker) parts.push(`blocked by "${decodeEntities(String(d.blocker)).slice(0, 60)}"`);
  if (d.label && d.linkType) parts.push(`${String(d.linkType)}: ${decodeEntities(String(d.label)).slice(0, 60)}`);
  if (d.added) parts.push(`added "${decodeEntities(String(d.added)).slice(0, 60)}"`);
  if (typeof d.minutes === 'number') parts.push(`${d.minutes} min${d.timer ? ' (timer)' : ''}`);
  if (Array.isArray(d.mentions) && d.mentions.length) parts.push(`${d.mentions.length} mentioned`);
  if (d.status && !d.changes) parts.push(`→ ${String(d.status)}`);
  if (d.count) parts.push(`${d.count} items`);
  if (d.response) parts.push(`Response: ${d.response}`);
  if (d.assignedToId) parts.push(`Assigned to: ${String(d.assignedToId).slice(0, 8)}…`);
  if (d.previousName && d.previousName !== d.name) parts.push(`was "${String(d.previousName)}"`);
  // Deleting a label cascades through TaskLabel, detaching it from every task
  // that had it. That count is the part you cannot reconstruct afterwards.
  if (typeof d.detachedFromTasks === 'number') {
    parts.push(`detached from ${d.detachedFromTasks} task${d.detachedFromTasks === 1 ? '' : 's'}`);
  }
  if (d.changes) {
    const changes = d.changes as string[];
    const from = isMap(d.from) ? d.from : {};
    const to = isMap(d.to) ? d.to : {};
    const show = (v: unknown) => {
      if (v === null || v === undefined || v === '') return '—';
      const str = String(v);
      // Dates arrive as ISO strings; nobody reads a Z-suffixed timestamp.
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str) && !Number.isNaN(Date.parse(str))) return format(new Date(str), 'MMM d, yyyy h:mm a');
      return str.slice(0, 30);
    };
    parts.push(
      changes
        .map((k) => (k in from || k in to ? `${k}: ${show(from[k])} → ${show(to[k])}` : k))
        .join(', ')
    );
  }

  return parts.join(' · ') || '—';
}

export function ActivityLogPage() {
  const { addNotification } = useUIStore();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(pageSize),
      };
      if (search) params.search = search;
      if (entityTypeFilter) params.entityType = entityTypeFilter;
      const { data: response } = await auditApi.getAll(params);
      setLogs(response.data);
      setTotal(response.meta.total);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load activity logs' });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, entityTypeFilter, addNotification]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const rows = logs.map((l) => ({
    id: l.id,
    createdAt: l.createdAt,
    action: l.action,
    entityType: l.entityType,
    summary: getSummary(l),
    status: l.status,
  }));

  return (
    <div className="activity-log-page">
      <PageHeader title="Activity Log" subtitle="Track all actions performed in the application" />

      {loading && logs.length === 0 ? (
        <SkeletonText paragraph lineCount={10} />
      ) : logs.length === 0 && !search && !entityTypeFilter ? (
        <EmptyState title="No activity yet" description="Actions you perform will appear here" icon={<Activity size={48} />} />
      ) : (
        <DataTable rows={rows} headers={headers} isSortable={false}>
          {({ rows: tableRows, headers: tableHeaders, getTableProps, getHeaderProps, getRowProps }) => (
            <TableContainer>
              <TableToolbar>
                <TableToolbarContent>
                  <TableToolbarSearch
                    placeholder="Search activity..."
                    onChange={(e) => { setSearch(toolbarSearchValue(e)); setPage(1); }}
                    persistent
                  />
                  <TableFilterFlyout
                    activeFilterCount={entityTypeFilter ? 1 : 0}
                    onReset={() => { setEntityTypeFilter(''); setPage(1); }}
                  >
                    <Dropdown
                      id="entity-type-filter"
                      titleText="Entity type"
                      label="All types"
                      items={entityTypeItems}
                      itemToString={(item) => item?.text || ''}
                      selectedItem={entityTypeItems.find((i) => i.id === entityTypeFilter) || entityTypeItems[0]}
                      onChange={({ selectedItem }) => setEntityTypeFilter(selectedItem?.id || '')}
                    />
                  </TableFilterFlyout>
                </TableToolbarContent>
              </TableToolbar>
              <Table {...getTableProps()} size="lg">
                <TableHead>
                  <TableRow>
                    {tableHeaders.map((h) => (
                      <TableHeader {...getHeaderProps({ header: h })} key={h.key}>{h.header}</TableHeader>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tableRows.map((row, i) => {
                    const entry = logs[i];
                    if (!entry) return null;
                    return (
                      <TableRow
                        {...getRowProps({ row })}
                        key={row.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedLog(entry)}
                      >
                        <TableCell>
                          <span title={format(new Date(entry.createdAt), 'PPpp')}>
                            {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Tag size="sm" type={(actionColors[entry.action] || 'cool-gray') as any}>
                            {actionLabels[entry.action] || entry.action}
                          </Tag>
                        </TableCell>
                        <TableCell>
                          <span style={{ textTransform: 'capitalize' }}>{entry.entityType.replace('_', ' ')}</span>
                        </TableCell>
                        <TableCell>
                          <span style={{ fontSize: '0.8125rem', color: 'var(--cds-text-secondary)' }}>
                            {getSummary(entry)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Tag size="sm" type={entry.status === 'success' ? 'green' : 'red'}>
                            {entry.status}
                          </Tag>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
      )}

      {total > pageSize && (
        <Pagination
          totalItems={total}
          pageSize={pageSize}
          pageSizes={[20, 50, 100]}
          page={page}
          onChange={({ page: p, pageSize: ps }: { page: number; pageSize: number }) => {
            if (ps !== pageSize) { setPageSize(ps); setPage(1); }
            else setPage(p);
          }}
        />
      )}

      {/* Detail Modal */}
      <Modal
        open={!!selectedLog}
        onRequestClose={() => setSelectedLog(null)}
        modalHeading="Activity Detail"
        passiveModal
        size="md"
      >
        {selectedLog && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <strong>Time:</strong> {format(new Date(selectedLog.createdAt), 'PPpp')}
            </div>
            <div>
              <strong>Action:</strong>{' '}
              <Tag size="sm" type={(actionColors[selectedLog.action] || 'cool-gray') as any}>
                {actionLabels[selectedLog.action] || selectedLog.action}
              </Tag>
            </div>
            <div>
              <strong>Entity Type:</strong> <span style={{ textTransform: 'capitalize' }}>{selectedLog.entityType.replace('_', ' ')}</span>
            </div>
            {selectedLog.entityId && (
              <div>
                <strong>Entity ID:</strong> <code style={{ fontSize: '0.75rem' }}>{selectedLog.entityId}</code>
              </div>
            )}
            <div>
              <strong>Status:</strong>{' '}
              <Tag size="sm" type={selectedLog.status === 'success' ? 'green' : 'red'}>{selectedLog.status}</Tag>
            </div>
            {selectedLog.details && (
              <div>
                <strong>Details:</strong>
                <pre style={{
                  background: 'var(--cds-layer-02)',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  overflow: 'auto',
                  maxHeight: '300px',
                  marginTop: '0.5rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </div>
            )}
            <div>
              <strong>User:</strong> {selectedLog.user.name || selectedLog.user.email}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
