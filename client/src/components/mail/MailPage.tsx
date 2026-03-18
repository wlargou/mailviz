import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Pagination,
  Button,
  Tag,
  InlineLoading,
  ContentSwitcher,
  Switch,
} from '@carbon/react';
import { Renew, StarFilled, Star, Attachment, Email as EmailIcon, Archive, TrashCan, Undo, Add, CheckmarkOutline, Close, CheckboxCheckedFilled } from '@carbon/icons-react';
import { SidePanel } from '@carbon/ibm-products';
import { formatDistanceToNow } from 'date-fns';
import { useSearchParams } from 'react-router-dom';
import { emailsApi } from '../../api/emails';
import { customersApi } from '../../api/customers';
import { useUIStore } from '../../store/uiStore';
import { useEmailWebSocket } from '../../hooks/useEmailWebSocket';
import { EmptyState } from '../shared/EmptyState';
import { ThreadDetail } from './ThreadDetail';
import { MailSearchBar } from './MailSearchBar';
import { MailComposeModal } from './MailComposeModal';
import type { MailFilters } from './MailSearchBar';
import type { EmailThread } from '../../types/email';
import type { Customer } from '../../types/customer';
import type { PaginationMeta } from '../../types/api';

const defaultFilters: MailFilters = {
  search: '',
  from: '',
  to: '',
  subject: '',
  dateAfter: '',
  dateBefore: '',
  customerIds: [],
  isRead: null,
  hasAttachment: false,
  folder: null,
};

export function MailPage() {
  const [searchParams] = useSearchParams();
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<MailFilters>(() => {
    const initial = { ...defaultFilters };
    const isRead = searchParams.get('isRead');
    const hasAttachment = searchParams.get('hasAttachment');
    const folder = searchParams.get('folder');
    if (isRead !== null) initial.isRead = isRead;
    if (hasAttachment === 'true') initial.hasAttachment = true;
    if (folder) initial.folder = folder;
    return initial;
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const addNotification = useUIStore((s) => s.addNotification);

  // Real-time WebSocket: auto-refresh thread list when sync finds new emails or state changes
  const wsHandlers = useMemo(() => ({
    'emails:synced': () => {
      fetchThreadsRef.current?.(true);
    },
    'email:updated': () => {
      fetchThreadsRef.current?.(true);
    },
    'email:deleted': () => {
      fetchThreadsRef.current?.(true);
    },
    'email:sent': () => {
      fetchThreadsRef.current?.(true);
    },
  }), []);
  useEmailWebSocket(wsHandlers);

  // Ref to fetchThreads so WS handlers don't need it as a dependency
  const fetchThreadsRef = useRef<((silent?: boolean) => void) | null>(null);

  useEffect(() => {
    customersApi.getAll({ limit: '500' }).then(({ data: res }) => {
      setCustomers(res.data);
    }).catch(() => {});
  }, []);

  const fetchThreads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: '20' };
      if (filters.search) params.search = filters.search;
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      if (filters.subject) params.subject = filters.subject;
      if (filters.dateAfter) params.dateAfter = filters.dateAfter;
      if (filters.dateBefore) params.dateBefore = filters.dateBefore;
      if (filters.customerIds.length > 0) params.customerId = filters.customerIds.join(',');
      if (filters.isRead !== null) params.isRead = filters.isRead;
      if (filters.hasAttachment) params.hasAttachment = 'true';
      if (filters.folder) params.folder = filters.folder;
      const { data: response } = await emailsApi.getThreads(params);
      setThreads(response.data);
      setMeta(response.meta || null);
    } catch {
      if (!silent) addNotification({ kind: 'error', title: 'Failed to load emails' });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, filters, addNotification]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // Keep ref in sync for WebSocket handlers
  useEffect(() => {
    fetchThreadsRef.current = fetchThreads;
  }, [fetchThreads]);

  const handleFiltersChange = (newFilters: MailFilters) => {
    setFilters(newFilters);
    setPage(1);
  };

  const handleFolderChange = (folder: string | null) => {
    setFilters((prev) => ({ ...prev, folder }));
    setPage(1);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data: res } = await emailsApi.sync();
      addNotification({
        kind: 'success',
        title: `Synced ${res.data.synced} emails`,
        subtitle: res.data.customersCreated > 0 || res.data.contactsCreated > 0
          ? `${res.data.customersCreated} companies, ${res.data.contactsCreated} contacts created`
          : undefined,
      });
      fetchThreads();
    } catch {
      addNotification({ kind: 'error', title: 'Email sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  const handleThreadAction = useCallback(async (
    action: 'star' | 'archive' | 'trash' | 'readToggle',
    thread: EmailThread,
    ev: React.MouseEvent,
  ) => {
    ev.stopPropagation();
    const emailId = thread.latestEmail.id;
    const e = thread.latestEmail;
    const isUnread = thread.unreadCount > 0;

    try {
      switch (action) {
        case 'star':
          setThreads((prev) => prev.map((t) =>
            t.threadId === thread.threadId
              ? { ...t, latestEmail: { ...t.latestEmail, isStarred: !t.latestEmail.isStarred } }
              : t
          ));
          await emailsApi.toggleStar(emailId);
          break;

        case 'archive':
          if (e.isArchived) {
            setThreads((prev) => prev.map((t) =>
              t.threadId === thread.threadId
                ? { ...t, latestEmail: { ...t.latestEmail, isArchived: false } }
                : t
            ));
            await emailsApi.unarchive(emailId);
            addNotification({ kind: 'success', title: 'Moved to Inbox' });
          } else {
            if (filters.folder === 'inbox' || filters.folder === null) {
              setThreads((prev) => prev.filter((t) => t.threadId !== thread.threadId));
            } else {
              setThreads((prev) => prev.map((t) =>
                t.threadId === thread.threadId
                  ? { ...t, latestEmail: { ...t.latestEmail, isArchived: true } }
                  : t
              ));
            }
            await emailsApi.archive(emailId);
            addNotification({ kind: 'success', title: 'Archived' });
          }
          break;

        case 'trash':
          if (e.isTrashed) {
            if (filters.folder === 'trash') {
              setThreads((prev) => prev.filter((t) => t.threadId !== thread.threadId));
            } else {
              setThreads((prev) => prev.map((t) =>
                t.threadId === thread.threadId
                  ? { ...t, latestEmail: { ...t.latestEmail, isTrashed: false } }
                  : t
              ));
            }
            await emailsApi.untrash(emailId);
            addNotification({ kind: 'success', title: 'Restored from trash' });
          } else {
            if (filters.folder !== 'trash') {
              setThreads((prev) => prev.filter((t) => t.threadId !== thread.threadId));
            } else {
              setThreads((prev) => prev.map((t) =>
                t.threadId === thread.threadId
                  ? { ...t, latestEmail: { ...t.latestEmail, isTrashed: true } }
                  : t
              ));
            }
            await emailsApi.trash(emailId);
            addNotification({ kind: 'success', title: 'Moved to trash' });
          }
          break;

        case 'readToggle':
          if (isUnread) {
            setThreads((prev) => prev.map((t) =>
              t.threadId === thread.threadId
                ? { ...t, unreadCount: 0, latestEmail: { ...t.latestEmail, isRead: true } }
                : t
            ));
            await emailsApi.markAsRead(emailId);
          } else {
            setThreads((prev) => prev.map((t) =>
              t.threadId === thread.threadId
                ? { ...t, unreadCount: 1, latestEmail: { ...t.latestEmail, isRead: false } }
                : t
            ));
            await emailsApi.markAsUnread(emailId);
          }
          break;
      }
      fetchThreads(true);
    } catch {
      fetchThreads(true);
      addNotification({ kind: 'error', title: 'Action failed' });
    }
  }, [filters.folder, addNotification, fetchThreads]);

  const selectAll = useCallback(() => {
    if (selectedIds.size === threads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(threads.map((t) => t.latestEmail.id)));
    }
  }, [threads, selectedIds.size]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
  }, []);

  const handleBulkAction = useCallback(async (action: 'read' | 'unread' | 'archive' | 'trash') => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    const ids = Array.from(selectedIds);
    try {
      switch (action) {
        case 'read':
          await emailsApi.batchMarkAsRead(ids);
          addNotification({ kind: 'success', title: `${ids.length} marked as read` });
          break;
        case 'unread':
          await emailsApi.batchMarkAsUnread(ids);
          addNotification({ kind: 'success', title: `${ids.length} marked as unread` });
          break;
        case 'archive':
          await emailsApi.batchArchive(ids);
          addNotification({ kind: 'success', title: `${ids.length} archived` });
          break;
        case 'trash':
          await emailsApi.batchTrash(ids);
          addNotification({ kind: 'success', title: `${ids.length} moved to trash` });
          break;
      }
      setSelectedIds(new Set());
      fetchThreads(true);
    } catch {
      addNotification({ kind: 'error', title: 'Bulk action failed' });
    } finally {
      setBulkLoading(false);
    }
  }, [selectedIds, addNotification, fetchThreads]);

  const hasActiveFilters = filters.search || filters.from || filters.to || filters.subject ||
    filters.dateAfter || filters.dateBefore || filters.customerIds.length > 0 || filters.isRead !== null ||
    filters.hasAttachment;

  const selectedThreadData = selectedThread
    ? threads.find((t) => t.threadId === selectedThread)
    : null;

  return (
    <div className="mail-page">
      <div className="mail-page__list">
        <div className="page-header" style={{ padding: '0 1rem' }}>
          <div className="page-header__info">
            <h1>Mail</h1>
            <p className="page-header__subtitle">Email threads synced from Gmail</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button
              kind="primary"
              size="sm"
              renderIcon={Add}
              onClick={() => setComposeOpen(true)}
            >
              Compose
            </Button>
            <Button
              kind={selectMode ? 'secondary' : 'ghost'}
              size="sm"
              renderIcon={CheckboxCheckedFilled}
              onClick={() => {
                if (selectMode) {
                  clearSelection();
                } else {
                  setSelectMode(true);
                }
              }}
            >
              Select
            </Button>
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Renew}
              onClick={handleSync}
              disabled={syncing}
            >
              {syncing ? 'Syncing...' : 'Sync'}
            </Button>
          </div>
        </div>

        <div className="mail-folder-switcher">
          <ContentSwitcher
            size="sm"
            selectedIndex={
              filters.folder === null ? 0
              : filters.folder === 'inbox' ? 1
              : filters.folder === 'sent' ? 2
              : filters.folder === 'starred' ? 3
              : filters.folder === 'archived' ? 4
              : filters.folder === 'trash' ? 5
              : 0
            }
            onChange={(e: { index: number }) => {
              const folders = [null, 'inbox', 'sent', 'starred', 'archived', 'trash'];
              handleFolderChange(folders[e.index]);
            }}
          >
            <Switch name="all" text="All" />
            <Switch name="inbox" text="Inbox" />
            <Switch name="sent" text="Sent" />
            <Switch name="starred" text="Starred" />
            <Switch name="archived" text="Archived" />
            <Switch name="trash" text="Trash" />
          </ContentSwitcher>
        </div>

        <div style={{ padding: '0 1rem', marginBottom: '0.75rem' }}>
          <MailSearchBar
            filters={filters}
            onFiltersChange={handleFiltersChange}
            customers={customers}
          />
        </div>

        {syncing && (
          <div style={{ padding: '0.5rem 1rem' }}>
            <InlineLoading description="Syncing emails from Gmail..." />
          </div>
        )}

        {loading && !syncing ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <InlineLoading description="Loading emails..." />
          </div>
        ) : threads.length === 0 ? (
          <EmptyState
            title="No emails"
            description={hasActiveFilters ? 'No emails match your filters' : 'Click Sync to import emails from Gmail'}
            icon={<EmailIcon size={48} />}
          />
        ) : (
          <>
            {selectMode && (
              <div className="bulk-action-bar">
                <div className="bulk-action-bar__info">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === threads.length && threads.length > 0}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < threads.length;
                    }}
                    onChange={selectAll}
                  />
                  <span className="bulk-action-bar__count">
                    {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select emails'}
                  </span>
                </div>
                <div className="bulk-action-bar__actions">
                  <Button kind="ghost" size="sm" hasIconOnly iconDescription="Mark as read" renderIcon={CheckmarkOutline} onClick={() => handleBulkAction('read')} disabled={bulkLoading || selectedIds.size === 0} />
                  <Button kind="ghost" size="sm" hasIconOnly iconDescription="Mark as unread" renderIcon={EmailIcon} onClick={() => handleBulkAction('unread')} disabled={bulkLoading || selectedIds.size === 0} />
                  <Button kind="ghost" size="sm" hasIconOnly iconDescription="Archive" renderIcon={Archive} onClick={() => handleBulkAction('archive')} disabled={bulkLoading || selectedIds.size === 0} />
                  <Button kind="ghost" size="sm" hasIconOnly iconDescription="Trash" renderIcon={TrashCan} onClick={() => handleBulkAction('trash')} disabled={bulkLoading || selectedIds.size === 0} />
                  <Button kind="ghost" size="sm" hasIconOnly iconDescription="Exit select mode" renderIcon={Close} onClick={clearSelection} />
                </div>
              </div>
            )}
            <div className={`thread-list${selectMode ? ' thread-list--select-mode' : ''}`}>
              {threads.map((thread) => {
                const e = thread.latestEmail;
                const isUnread = thread.unreadCount > 0;
                const isSelected = thread.threadId === selectedThread;
                const isChecked = selectedIds.has(e.id);

                return (
                  <div
                    key={thread.threadId}
                    className={`thread-item-row${isChecked ? ' thread-item-row--checked' : ''}`}
                  >
                    {selectMode && (
                      <div
                        className="thread-item__select"
                        onClick={() => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(e.id)) next.delete(e.id);
                            else next.add(e.id);
                            return next;
                          });
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                        />
                      </div>
                    )}
                    <div
                      role="button"
                      tabIndex={0}
                      className={`thread-item${isUnread ? ' thread-item--unread' : ' thread-item--read'}${isSelected ? ' thread-item--selected' : ''}${isChecked ? ' thread-item--checked' : ''}`}
                      onClick={() => setSelectedThread(thread.threadId)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          setSelectedThread(thread.threadId);
                        }
                      }}
                    >
                    <div className="thread-item__top">
                      <span className="thread-item__sender">
                        {e.fromName || e.from}
                      </span>
                      <span className="thread-item__meta">
                        {e.isStarred && <StarFilled size={14} className="thread-item__star" />}
                        {e.hasAttachment && <Attachment size={14} className="thread-item__attachment" />}
                        {thread.messageCount > 1 && (
                          <Tag size="sm" type="cool-gray">{thread.messageCount}</Tag>
                        )}
                        <span>{formatDistanceToNow(new Date(e.receivedAt), { addSuffix: true })}</span>
                      </span>
                      <div className="thread-item__actions">
                        <Button
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          iconDescription={e.isStarred ? 'Unstar' : 'Star'}
                          renderIcon={e.isStarred ? StarFilled : Star}
                          className={e.isStarred ? 'thread-action--starred' : ''}
                          onClick={(ev: React.MouseEvent) => handleThreadAction('star', thread, ev)}
                        />
                        <Button
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          iconDescription={e.isArchived ? 'Unarchive' : 'Archive'}
                          renderIcon={e.isArchived ? Undo : Archive}
                          onClick={(ev: React.MouseEvent) => handleThreadAction('archive', thread, ev)}
                        />
                        <Button
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          iconDescription={e.isTrashed ? 'Restore' : 'Trash'}
                          renderIcon={e.isTrashed ? Undo : TrashCan}
                          onClick={(ev: React.MouseEvent) => handleThreadAction('trash', thread, ev)}
                        />
                        <Button
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          iconDescription={isUnread ? 'Mark as read' : 'Mark as unread'}
                          renderIcon={EmailIcon}
                          onClick={(ev: React.MouseEvent) => handleThreadAction('readToggle', thread, ev)}
                        />
                      </div>
                    </div>
                    <div className="thread-item__subject">{e.subject}</div>
                    <div className="thread-item__snippet">{e.snippet}</div>
                    {e.customer && (
                      <div className="thread-item__customer">
                        {e.customer.logoUrl && (
                          <img
                            src={e.customer.logoUrl}
                            alt=""
                            className="customer-logo"
                            onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        )}
                        <span>{e.customer.name}</span>
                      </div>
                    )}
                    </div>
                  </div>
                );
              })}
            </div>
            {meta && meta.totalPages > 1 && (
              <Pagination
                totalItems={meta.total}
                pageSize={meta.limit}
                pageSizes={[10, 20, 50]}
                page={page}
                onChange={({ page: p }: { page: number }) => setPage(p)}
              />
            )}
          </>
        )}
      </div>

      <SidePanel
        open={!!selectedThread}
        onRequestClose={() => setSelectedThread(null)}
        title={selectedThreadData?.latestEmail.subject || 'Thread'}
        size="lg"
        slideIn
        selectorPageContent=".app-content"
        className="mail-page__side-panel"
      >
        {selectedThread && (
          <ThreadDetail
            threadId={selectedThread}
            onEmailAction={() => fetchThreads(true)}
          />
        )}
      </SidePanel>

      <MailComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSent={() => {
          setComposeOpen(false);
          fetchThreads(true);
        }}
        mode="new"
      />
    </div>
  );
}
