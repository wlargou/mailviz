import React, { useEffect, useState, useCallback, useRef } from 'react';
import { isAxiosError } from 'axios';
import {
  Button,
  Column,
  Grid,
  InlineLoading,
  InlineNotification,
  Layer,
  ListItem,
  Modal,
  ProgressBar,
  Stack,
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  TextInput,
  Tile,
  UnorderedList,
} from '@carbon/react';
import { Add, Calendar, Checkmark, Draggable, Edit, Email, Enterprise, Misuse, Partnership, Pen, Renew, Tag as TagIcon, TaskComplete, TrashCan, WarningAlt } from '@carbon/icons-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSearchParams } from 'react-router-dom';
import { authApi, type AccountDeletionSummary } from '../../api/auth';
import { TiptapEditor } from '../mail/TiptapEditor';
import { TemplateSettings } from './TemplateSettings';
import { OnboardingSettings } from './OnboardingSettings';
import { taskStatusesApi } from '../../api/taskStatuses';
import { companyCategoriesApi } from '../../api/companyCategories';
import { dealPartnersApi } from '../../api/dealPartners';
import { labelsApi } from '../../api/labels';
import { useUIStore } from '../../store/uiStore';
import type { Label, TaskStatusConfig } from '../../types/task';
import type { CompanyCategory } from '../../types/customer';
import type { DealPartner } from '../../types/deal';
import type { GoogleStatus } from '../../types/calendar';
import { format } from 'date-fns';
import { SettingsListEditor } from './SettingsListEditor';
import { SettingsSection } from './SettingsSection';
import { DeleteAccountModal } from './DeleteAccountModal';

const STATUS_COLORS = [
  { hex: '#4589ff', label: 'Blue' },
  { hex: '#8a3ffc', label: 'Purple' },
  { hex: '#d2a106', label: 'Yellow' },
  { hex: '#42be65', label: 'Green' },
  { hex: '#08bdba', label: 'Teal' },
  { hex: '#ff832b', label: 'Orange' },
  { hex: '#ee5396', label: 'Pink' },
  { hex: '#da1e28', label: 'Red' },
  { hex: '#878d96', label: 'Gray' },
];

/** Shape of the JSON error envelope returned by the API's errorHandler middleware. */
interface ApiErrorLike {
  response?: { data?: { error?: { message?: string } } };
}

function apiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as ApiErrorLike | null | undefined)?.response?.data?.error?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

/** An item that lives in an ordered settings list (task statuses, company categories). */
interface OrderedSettingsItem {
  id: string;
  label: string;
  position: number;
}

/** Recompute contiguous positions for every row after a move. */
function withRecomputedPositions<T extends OrderedSettingsItem>(items: T[]): T[] {
  return items.map((item, index) => ({ ...item, position: index }));
}

interface SortableSettingsRowProps {
  id: string;
  /** Accessible name for the icon-only drag handle, e.g. `Reorder "In Progress"`. */
  dragDescription: string;
  children: React.ReactNode;
}

/**
 * A `StructuredListRow` that can be reordered by pointer drag or by keyboard from its
 * handle. Carbon's `StructuredListRow` attaches its own internal ref to the rendered
 * `<div role="row">`, so a ref passed as a prop would be discarded — instead the handle
 * cell resolves the row element with `closest()` and hands that to dnd-kit, which keeps
 * the Carbon table markup (and its column alignment) intact.
 */
function SortableSettingsRow({ id, dragDescription, children }: SortableSettingsRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const rowRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node ? node.closest<HTMLElement>('.cds--structured-list-row') : null);
    },
    [setNodeRef]
  );

  return (
    <StructuredListRow
      className={`settings-sortable-row${isDragging ? ' settings-sortable-row--dragging' : ''}`}
      // Zero out `x` so rows only ever travel along the vertical axis of the list.
      style={{
        transform: CSS.Translate.toString(transform && { ...transform, x: 0 }),
        transition,
      }}
    >
      <StructuredListCell className="settings-drag-cell">
        <div className="settings-drag-handle" ref={rowRef}>
          <Button
            kind="ghost"
            size="sm"
            hasIconOnly
            iconDescription={dragDescription}
            renderIcon={Draggable}
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
          />
        </div>
      </StructuredListCell>
      {children}
    </StructuredListRow>
  );
}

export function SettingsPage() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingMail, setSyncingMail] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteSummary, setDeleteSummary] = useState<AccountDeletionSummary | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [emailProgress, setEmailProgress] = useState<{ synced: number; total: number; phase: string } | null>(null);
  const [calendarProgress, setCalendarProgress] = useState<{ synced: number; total: number; phase: string } | null>(null);
  const addNotification = useUIStore((s) => s.addNotification);
  const [searchParams, setSearchParams] = useSearchParams();

  // Email signature
  const [signature, setSignature] = useState<string>('');
  const [signatureLoaded, setSignatureLoaded] = useState(false);
  const [savingSignature, setSavingSignature] = useState(false);
  const signatureEditorRef = useRef<any>(null);

  const [taskStatuses, setTaskStatuses] = useState<TaskStatusConfig[]>([]);
  const [newStatusLabel, setNewStatusLabel] = useState('');
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);

  const [categories, setCategories] = useState<CompanyCategory[]>([]);
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryLabel, setEditCategoryLabel] = useState('');
  const [categoryColorPickerOpen, setCategoryColorPickerOpen] = useState<string | null>(null);

  const [labels, setLabels] = useState<Label[]>([]);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(STATUS_COLORS[0].hex);
  const [newLabelColorPickerOpen, setNewLabelColorPickerOpen] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editLabelName, setEditLabelName] = useState('');
  const [labelColorPickerOpen, setLabelColorPickerOpen] = useState<string | null>(null);
  const [labelToDelete, setLabelToDelete] = useState<Label | null>(null);
  const [deletingLabel, setDeletingLabel] = useState(false);

  const [dealPartners, setDealPartners] = useState<DealPartner[]>([]);
  const [newPartnerName, setNewPartnerName] = useState('');
  const [newPartnerUrl, setNewPartnerUrl] = useState('');
  const [editingPartnerId, setEditingPartnerId] = useState<string | null>(null);
  const [editPartnerName, setEditPartnerName] = useState('');
  const [editPartnerUrl, setEditPartnerUrl] = useState('');

  // Same sensor setup as the Kanban board, plus a keyboard sensor so the drag handles
  // can reorder with arrow keys (Space/Enter to pick up and drop, Escape to cancel).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const fetchTaskStatuses = useCallback(async () => {
    try {
      const { data: res } = await taskStatusesApi.getAll();
      setTaskStatuses(res.data);
    } catch { /* ignore */ }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const { data: res } = await companyCategoriesApi.getAll();
      setCategories(res.data);
    } catch { /* ignore */ }
  }, []);

  const fetchLabels = useCallback(async () => {
    try {
      const { data: res } = await labelsApi.getAll();
      setLabels(res.data);
    } catch { /* ignore */ }
  }, []);

  const fetchDealPartners = useCallback(async () => {
    try {
      const { data: res } = await dealPartnersApi.getAll();
      setDealPartners(res.data);
    } catch { /* ignore */ }
  }, []);

  const fetchSignature = useCallback(async () => {
    try {
      const { data } = await authApi.getSignature();
      setSignature(data.signature || '');
      setSignatureLoaded(true);
    } catch { /* ignore */ }
  }, []);

  const handleSaveSignature = async () => {
    setSavingSignature(true);
    try {
      const html = signatureEditorRef.current?.getHTML() || '';
      // Treat empty editor as no signature
      const isEmpty = !html || html === '<p></p>' || html.trim() === '';
      await authApi.updateSignature(isEmpty ? null : html);
      setSignature(isEmpty ? '' : html);
      addNotification({ kind: 'success', title: 'Signature saved' });
    } catch {
      addNotification({ kind: 'error', title: 'Failed to save signature' });
    } finally {
      setSavingSignature(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchTaskStatuses();
    fetchCategories();
    fetchLabels();
    fetchDealPartners();
    fetchSignature();
  }, []);

  // WebSocket listener for sync progress
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'sync:progress') {
            const { type, synced, total, phase } = msg.data;
            if (type === 'email') {
              if (phase === 'complete') {
                setEmailProgress(null);
              } else {
                setEmailProgress({ synced, total, phase });
              }
            } else if (type === 'calendar') {
              if (phase === 'complete') {
                setCalendarProgress(null);
              } else {
                setCalendarProgress({ synced, total, phase });
              }
            }
          }
        } catch { /* ignore parse errors */ }
      };
    } catch { /* WS not available */ }

    return () => { ws?.close(); };
  }, []);

  useEffect(() => {
    if (searchParams.get('connected') === 'true') {
      addNotification({ kind: 'success', title: 'Google account connected — starting initial sync...' });
      setSearchParams({}, { replace: true });
      fetchStatus();
      // Auto-trigger both syncs after connecting
      setTimeout(() => {
        handleMailSync();
        handleSync();
      }, 500);
    }
  }, [searchParams, setSearchParams, addNotification]);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const { data: response } = await authApi.getGoogleStatus();
      setStatus(response.data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      const { data: response } = await authApi.getGoogleUrl();
      window.location.href = response.data.url;
    } catch {
      addNotification({ kind: 'error', title: 'Failed to start Google connection' });
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data: res } = await (await import('../../api/calendar')).calendarApi.sync();
      const parts = [`${res.data.synced} events synced`];
      if (res.data.customersCreated) parts.push(`${res.data.customersCreated} new companies`);
      if (res.data.contactsCreated) parts.push(`${res.data.contactsCreated} new contacts`);
      addNotification({ kind: 'success', title: 'Calendar synced', subtitle: parts.join(' · ') });
      fetchStatus();
    } catch {
      addNotification({ kind: 'error', title: 'Calendar sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  const handleMailSync = async () => {
    setSyncingMail(true);
    try {
      const { emailsApi } = await import('../../api/emails');
      const { data: res } = await emailsApi.sync();
      const parts = [`${res.data.synced} emails synced`];
      if (res.data.customersCreated) parts.push(`${res.data.customersCreated} new companies`);
      if (res.data.contactsCreated) parts.push(`${res.data.contactsCreated} new contacts`);
      addNotification({ kind: 'success', title: 'Gmail synced', subtitle: parts.join(' · ') });
      fetchStatus();
    } catch (err) {
      // 409: the scheduler already has a sync running for this account.
      if (isAxiosError(err) && err.response?.status === 409) {
        addNotification({ kind: 'info', title: 'A sync is already running' });
      } else {
        addNotification({ kind: 'error', title: 'Email sync failed' });
      }
    } finally {
      setSyncingMail(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await authApi.disconnectGoogle();
      setStatus({ connected: false });
      addNotification({ kind: 'success', title: 'Google account disconnected' });
    } catch {
      addNotification({ kind: 'error', title: 'Failed to disconnect' });
    } finally {
      setDisconnecting(false);
    }
  };

  /**
   * Open the confirmation and fetch the real row counts.
   *
   * The counts are loaded on open rather than with the page: they are only ever
   * read here, and a user agreeing to "delete everything" deserves to see that
   * it is 25,000 emails rather than a generic warning.
   */
  const openDeleteAccount = async () => {
    setDeleteConfirmText('');
    setDeleteSummary(null);
    setDeleteAccountOpen(true);
    try {
      const { data } = await authApi.getAccountDeletionSummary();
      setDeleteSummary(data.data);
    } catch {
      addNotification({ kind: 'error', title: 'Could not load account details' });
      setDeleteAccountOpen(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteSummary) return;
    setDeletingAccount(true);
    try {
      await authApi.deleteAccount(deleteConfirmText.trim());
      // The account is gone, so there is nothing to return to and no state
      // worth preserving. A hard navigation drops every store and cached
      // response rather than leaving a client rendering a deleted user.
      window.location.href = '/login';
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete account' });
      setDeletingAccount(false);
    }
  };

  const handleAddStatus = async (label: string) => {
    if (!label.trim()) return;
    try {
      await taskStatusesApi.create({ label: label.trim() });
      fetchTaskStatuses();
      addNotification({ kind: 'success', title: 'Status created' });
    } catch {
      addNotification({ kind: 'error', title: 'Failed to create status' });
    }
  };

  const handleDeleteStatus = async (s: TaskStatusConfig) => {
    try {
      await taskStatusesApi.delete(s.id);
      addNotification({ kind: 'success', title: `Status "${s.label}" deleted` });
      fetchTaskStatuses();
    } catch (err: any) {
      addNotification({
        kind: 'error',
        title: err?.response?.data?.error?.message || 'Cannot delete status',
      });
    }
  };

  const handleReorderStatuses = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = taskStatuses.findIndex((s) => s.id === active.id);
    const newIndex = taskStatuses.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const previous = taskStatuses;
    const reordered = withRecomputedPositions(arrayMove(taskStatuses, oldIndex, newIndex));
    setTaskStatuses(reordered);

    try {
      await taskStatusesApi.reorder(reordered.map((s) => ({ id: s.id, position: s.position })));
    } catch (err) {
      setTaskStatuses(previous);
      addNotification({
        kind: 'error',
        title: apiErrorMessage(err, 'Failed to reorder statuses'),
      });
    }
  };

  const handleSaveEditStatus = async (id: string, label: string) => {
    if (!label.trim()) return;
    await taskStatusesApi.update(id, { label: label.trim() });
    fetchTaskStatuses();
  };

  const handleAddCategory = async (label: string) => {
    if (!label.trim()) return;
    try {
      await companyCategoriesApi.create({ label: label.trim() });
      fetchCategories();
      addNotification({ kind: 'success', title: 'Category created' });
    } catch {
      addNotification({ kind: 'error', title: 'Failed to create category' });
    }
  };

  const handleDeleteCategory = async (c: CompanyCategory) => {
    try {
      await companyCategoriesApi.delete(c.id);
      addNotification({ kind: 'success', title: `Category "${c.label}" deleted` });
      fetchCategories();
    } catch (err: any) {
      addNotification({
        kind: 'error',
        title: err?.response?.data?.error?.message || 'Cannot delete category',
      });
    }
  };

  const handleReorderCategories = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const previous = categories;
    const reordered = withRecomputedPositions(arrayMove(categories, oldIndex, newIndex));
    setCategories(reordered);

    try {
      await companyCategoriesApi.reorder(reordered.map((c) => ({ id: c.id, position: c.position })));
    } catch (err) {
      setCategories(previous);
      addNotification({
        kind: 'error',
        title: apiErrorMessage(err, 'Failed to reorder categories'),
      });
    }
  };

  const handleSaveEditCategory = async (id: string, label: string) => {
    if (!label.trim()) return;
    await companyCategoriesApi.update(id, { label: label.trim() });
    fetchCategories();
  };

  // ── Label handlers ──
  const handleAddLabel = async (name: string) => {
    if (!name.trim()) return;
    try {
      await labelsApi.create({ name: name.trim(), color: newLabelColor });
      fetchLabels();
      addNotification({ kind: 'success', title: 'Label created' });
    } catch (err) {
      addNotification({
        kind: 'error',
        title: apiErrorMessage(err, 'Failed to create label'),
      });
    }
  };

  const handleDeleteLabel = async (l: Label) => {
    setDeletingLabel(true);
    try {
      await labelsApi.delete(l.id);
      addNotification({ kind: 'success', title: `Label "${l.name}" deleted` });
      fetchLabels();
      setLabelToDelete(null);
    } catch (err) {
      addNotification({
        kind: 'error',
        title: apiErrorMessage(err, 'Cannot delete label'),
      });
    } finally {
      setDeletingLabel(false);
    }
  };

  const handleSaveEditLabel = async (id: string, value: string) => {
    const name = value.trim();
    const current = labels.find((l) => l.id === id);
    if (!name || !current || name === current.name) return;
    try {
      await labelsApi.update(id, { name });
      fetchLabels();
    } catch (err) {
      addNotification({
        kind: 'error',
        title: apiErrorMessage(err, 'Failed to rename label'),
      });
      fetchLabels();
    }
  };

  // ── Deal Partner handlers ──
  const handleAddPartner = async (name: string) => {
    if (!name.trim()) return;
    try {
      await dealPartnersApi.create({ name: name.trim() });
      addNotification({ kind: 'success', title: 'Partner added' });
      fetchDealPartners();
    } catch (err: any) {
      addNotification({
        kind: 'error',
        title: err?.response?.data?.error?.message || 'Failed to add partner',
      });
    }
  };

  const handleDeletePartner = async (p: DealPartner) => {
    try {
      await dealPartnersApi.delete(p.id);
      addNotification({ kind: 'success', title: `Partner "${p.name}" deleted` });
      fetchDealPartners();
    } catch (err: any) {
      addNotification({
        kind: 'error',
        title: err?.response?.data?.error?.message || 'Cannot delete partner',
      });
    }
  };

  /** The registration URL is edited in its own column, independently of the name. */
  const handleSavePartnerUrl = async (id: string, registrationUrl: string) => {
    try {
      await dealPartnersApi.update(id, { registrationUrl: registrationUrl.trim() || undefined });
      fetchDealPartners();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to update registration URL' });
    }
  };

  const handleSaveEditPartner = async (id: string, name: string) => {
    if (!name.trim()) return;
    try {
      await dealPartnersApi.update(id, { name: name.trim() });
      fetchDealPartners();
    } catch (err: any) {
      addNotification({
        kind: 'error',
        title: err?.response?.data?.error?.message || 'Failed to update partner',
      });
    }
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <div className="page-header__info">
          <h1>Settings</h1>
          <p className="page-header__subtitle">Manage your integrations and preferences</p>
        </div>
      </div>

      <Grid fullWidth>
        <Column lg={16} md={8} sm={4}>
          {/*
            Tabs rather than one column of stacked tiles.

            Eight sections in a single scroll came to 3,397px: reaching Deal
            partners meant scrolling past everything else, and nothing on screen
            said the section existed. Grouping is also why the four list editors
            can now sit together — they are one kind of thing and belong in one
            place.
          */}
          <Tabs>
            <TabList aria-label="Settings sections" contained>
              <Tab>Account</Tab>
              <Tab>Mail</Tab>
              <Tab>Workspace</Tab>
              <Tab>Getting started</Tab>
            </TabList>
            <TabPanels>
          <TabPanel>
            <Stack gap={7}>
          <Tile className="settings-tile">
            <Stack gap={5}>
              <div className="settings-tile__header">
                <div className="settings-tile__icon settings-tile__icon--google">
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                </div>
                <div>
                  <h4 className="settings-tile__title">Google Account</h4>
                  <p className="settings-tile__desc">Sync your calendar events and emails</p>
                </div>
              </div>

              {loading ? (
                <InlineLoading description="Checking connection..." />
              ) : status?.connected ? (
                <Stack gap={4}>
                  <div className="settings-connection-status">
                    <Tag type="green" size="sm" renderIcon={Checkmark}>Connected</Tag>
                    {status.email && <span className="settings-connection-email">{status.email}</span>}
                    <div className="settings-connection-status__action">
                      {status.needsReauth ? (
                        <Button kind="primary" size="sm" renderIcon={WarningAlt} onClick={handleConnect}>
                          Reconnect
                        </Button>
                      ) : (
                        <Button kind="danger--ghost" size="sm" renderIcon={Misuse} onClick={() => setDisconnectConfirmOpen(true)} disabled={disconnecting}>
                          {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                        </Button>
                      )}
                    </div>
                  </div>

                  {status.needsReauth && (
                    <InlineNotification
                      kind="warning"
                      title="Permissions upgrade needed"
                      subtitle="Reconnect to enable email actions."
                      lowContrast
                      hideCloseButton
                    />
                  )}

                  <Layer>
                    <div className="settings-sync-grid">
                      <div className="settings-sync-item">
                        <Calendar size={16} />
                        <div className="settings-sync-item__info">
                          <span className="settings-sync-item__label">Calendar</span>
                          <span className="settings-sync-item__time">
                            {syncing
                              ? ''
                              : status.lastSyncAt
                                ? `Last synced ${format(new Date(status.lastSyncAt), 'MMM d, h:mm a')}`
                                : 'Not synced yet'}
                          </span>
                        </div>
                        {syncing ? (
                          calendarProgress && calendarProgress.synced > 0 ? (
                            <div style={{ minWidth: '180px' }}>
                              <ProgressBar
                                label={`${calendarProgress.synced} events synced`}
                                helperText="Syncing calendar..."
                                max={100}
                              />
                            </div>
                          ) : (
                            <InlineLoading description="Syncing calendar..." />
                          )
                        ) : (
                          <Button kind="tertiary" size="sm" renderIcon={Renew} onClick={handleSync}>
                            Sync
                          </Button>
                        )}
                      </div>
                      <div className="settings-sync-item">
                        <Email size={16} />
                        <div className="settings-sync-item__info">
                          <span className="settings-sync-item__label">Gmail</span>
                          <span className="settings-sync-item__time">
                            {syncingMail
                              ? ''
                              : status.lastMailSyncAt
                                ? `Last synced ${format(new Date(status.lastMailSyncAt), 'MMM d, h:mm a')}`
                                : 'Auto-syncs every 60s'}
                          </span>
                        </div>
                        {syncingMail ? (
                          emailProgress?.phase === 'counting' ? (
                            <InlineLoading description="Counting emails..." />
                          ) : emailProgress && emailProgress.total > 0 ? (
                            <div style={{ minWidth: '200px' }}>
                              <ProgressBar
                                label={`${emailProgress.synced} / ${emailProgress.total} emails`}
                                helperText={`${Math.round((emailProgress.synced / emailProgress.total) * 100)}% complete`}
                                value={Math.round((emailProgress.synced / emailProgress.total) * 100)}
                                max={100}
                              />
                            </div>
                          ) : (
                            <InlineLoading description="Syncing emails..." />
                          )
                        ) : (
                          <Button kind="tertiary" size="sm" renderIcon={Renew} onClick={handleMailSync}>
                            Sync
                          </Button>
                        )}
                      </div>
                    </div>
                  </Layer>

                </Stack>
              ) : (
                <Stack gap={4}>
                  <p className="settings-tile__desc">
                    No Google account connected. Connect to sync your calendar and emails.
                  </p>
                  <div>
                    <Button kind="primary" size="md" onClick={handleConnect}>
                      Connect Google Account
                    </Button>
                  </div>
                </Stack>
              )}
            </Stack>
          </Tile>

          <Tile className="settings-tile settings-tile--danger">
            <Stack gap={5}>
              <div className="settings-tile__header">
                <div className="settings-tile__icon settings-tile__icon--danger">
                  <TrashCan size={20} />
                </div>
                <div>
                  <h3 className="settings-tile__title">Delete account</h3>
                  <p className="settings-tile__desc">
                    Permanently remove this account and everything in it.
                  </p>
                </div>
              </div>
              <p className="settings-tile__desc">
                This removes your synced mail and calendar, your companies and contacts, and
                everything you have created here — tasks, deals, labels, templates and settings.
                It cannot be undone, and there is no export.
              </p>
              <div>
                <Button kind="danger--tertiary" size="md" onClick={openDeleteAccount}>
                  Delete account
                </Button>
              </div>
            </Stack>
          </Tile>
            </Stack>
          </TabPanel>
          <TabPanel>
            <Stack gap={7}>
          <Tile className="settings-tile">
            <Stack gap={5}>
              <div className="settings-tile__header">
                <Pen size={24} />
                <div>
                  <h4 className="settings-tile__title">Email Signature</h4>
                  <p className="settings-tile__subtitle">Automatically included in new emails, replies, and forwards</p>
                </div>
              </div>
              {signatureLoaded && (
                <div style={{ border: '1px solid var(--cds-border-subtle)', borderRadius: '4px', minHeight: '120px' }}>
                  <TiptapEditor
                    content={signature}
                    editorRef={signatureEditorRef}
                    placeholder="Write your email signature..."
                  />
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button
                  size="sm"
                  kind="primary"
                  onClick={handleSaveSignature}
                  disabled={savingSignature}
                >
                  {savingSignature ? 'Saving...' : 'Save Signature'}
                </Button>
                <Button
                  size="sm"
                  kind="ghost"
                  onClick={() => {
                    if (signatureEditorRef.current) {
                      signatureEditorRef.current.commands.clearContent();
                    }
                  }}
                >
                  Clear
                </Button>
              </div>
            </Stack>
          </Tile>

          <TemplateSettings />
            </Stack>
          </TabPanel>
          <TabPanel>
            <div className="settings-panel-grid">
          <Tile className="settings-tile">
            <SettingsSection
              icon={<TaskComplete size={20} />}
              title="Task statuses"
              description="The columns on your Kanban board. Drag to reorder."
            >
              <SettingsListEditor
                items={taskStatuses.map((s) => ({ id: s.id, label: s.label, color: s.color, badge: s.name }))}
                labelHeading="Label"
                badgeHeading="Key"
                addPlaceholder="e.g. Blocked, In review"
                addLabel="Add status"
                emptyMessage="No statuses yet — your board has no columns."
                colors={STATUS_COLORS}
                sensors={sensors}
                onReorder={handleReorderStatuses}
                onAdd={handleAddStatus}
                onRename={handleSaveEditStatus}
                onRecolor={async (id, color) => {
                  setTaskStatuses((prev) => prev.map((t) => (t.id === id ? { ...t, color } : t)));
                  try {
                    await taskStatusesApi.update(id, { color });
                  } catch {
                    fetchTaskStatuses();
                  }
                }}
                onDelete={(item) => {
                  const status = taskStatuses.find((t) => t.id === item.id);
                  if (status) handleDeleteStatus(status);
                }}
              />
            </SettingsSection>
          </Tile>

          <Tile className="settings-tile">
            <SettingsSection
              icon={<Enterprise size={20} />}
              title="Company categories"
              description="How companies are grouped. Drag to reorder."
            >
              <SettingsListEditor
                items={categories.map((c) => ({ id: c.id, label: c.label, color: c.color, badge: c.name }))}
                labelHeading="Label"
                badgeHeading="Key"
                addPlaceholder="e.g. Partner, Prospect"
                addLabel="Add category"
                emptyMessage="No categories yet."
                colors={STATUS_COLORS}
                sensors={sensors}
                onReorder={handleReorderCategories}
                onAdd={handleAddCategory}
                onRename={handleSaveEditCategory}
                onRecolor={async (id, color) => {
                  setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, color } : c)));
                  try {
                    await companyCategoriesApi.update(id, { color });
                  } catch {
                    fetchCategories();
                  }
                }}
                onDelete={(item) => {
                  const category = categories.find((c) => c.id === item.id);
                  if (category) handleDeleteCategory(category);
                }}
              />
            </SettingsSection>
          </Tile>

          <Tile className="settings-tile">
            <SettingsSection
              icon={<TagIcon size={20} />}
              title="Labels"
              description="Tags you can attach to tasks."
            >
              <SettingsListEditor
                items={labels.map((l) => ({ id: l.id, label: l.name, color: l.color }))}
                labelHeading="Name"
                addPlaceholder="e.g. Urgent, Follow-up"
                addLabel="Add label"
                emptyMessage="No labels yet."
                colors={STATUS_COLORS}
                onAdd={handleAddLabel}
                onRename={handleSaveEditLabel}
                onRecolor={async (id, color) => {
                  setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, color } : l)));
                  try {
                    await labelsApi.update(id, { color });
                  } catch {
                    fetchLabels();
                  }
                }}
                onDelete={(item) => {
                  const label = labels.find((l) => l.id === item.id);
                  if (label) handleDeleteLabel(label);
                }}
              />
            </SettingsSection>
          </Tile>

          <Tile className="settings-tile">
            <SettingsSection
              icon={<Partnership size={20} />}
              title="Deal partners"
              description="Vendors and distributors you register deals against. A deal cannot be created without one."
            >
              <SettingsListEditor
                items={dealPartners.map((p) => ({ id: p.id, label: p.name, secondary: p.registrationUrl }))}
                labelHeading="Name"
                secondaryHeading="Registration URL"
                addPlaceholder="e.g. Dell, IBM, Fortinet"
                addLabel="Add partner"
                emptyMessage="No partners yet — deals cannot be created until you add one."
                onAdd={handleAddPartner}
                onRename={handleSaveEditPartner}
                onEditSecondary={handleSavePartnerUrl}
                onDelete={(item) => {
                  const partner = dealPartners.find((p) => p.id === item.id);
                  if (partner) handleDeletePartner(partner);
                }}
              />
            </SettingsSection>
          </Tile>
            </div>
          </TabPanel>
          <TabPanel>
            <Stack gap={7}>
          <OnboardingSettings />
            </Stack>
          </TabPanel>
            </TabPanels>
          </Tabs>
        </Column>
      </Grid>

      <Modal
        open={labelToDelete !== null}
        danger
        modalHeading={labelToDelete ? `Delete label "${labelToDelete.name}"?` : 'Delete label'}
        primaryButtonText={deletingLabel ? 'Deleting...' : 'Delete'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={deletingLabel}
        onRequestClose={() => setLabelToDelete(null)}
        onRequestSubmit={() => { if (labelToDelete) handleDeleteLabel(labelToDelete); }}
      >
        {labelToDelete && (labelToDelete._count?.tasks ?? 0) > 0 ? (
          <p>
            This label is currently attached to{' '}
            <strong>
              {labelToDelete._count?.tasks}{' '}
              {labelToDelete._count?.tasks === 1 ? 'task' : 'tasks'}
            </strong>
            . Deleting it removes the label from{' '}
            {labelToDelete._count?.tasks === 1 ? 'that task' : 'those tasks'} — the{' '}
            {labelToDelete._count?.tasks === 1 ? 'task itself is' : 'tasks themselves are'} kept.
            This action cannot be undone.
          </p>
        ) : (
          <p>This label isn&apos;t attached to any tasks. This action cannot be undone.</p>
        )}
      </Modal>

      <DeleteAccountModal
        open={deleteAccountOpen}
        summary={deleteSummary}
        confirmText={deleteConfirmText}
        onConfirmTextChange={setDeleteConfirmText}
        deleting={deletingAccount}
        onClose={() => setDeleteAccountOpen(false)}
        onConfirm={handleDeleteAccount}
      />

      <Modal
        open={disconnectConfirmOpen}
        danger
        modalHeading="Disconnect Google Account"
        primaryButtonText={disconnecting ? 'Disconnecting...' : 'Disconnect'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={disconnecting}
        onRequestClose={() => setDisconnectConfirmOpen(false)}
        onRequestSubmit={async () => {
          await handleDisconnect();
          setDisconnectConfirmOpen(false);
        }}
      >
        <p style={{ marginBottom: '1rem' }}>
          <strong>Warning:</strong> Disconnecting your Google account will permanently delete the following data:
        </p>
        <UnorderedList>
          <ListItem>All synced emails and attachments</ListItem>
          <ListItem>All calendar events</ListItem>
          <ListItem>All companies and contacts (auto-discovered from emails)</ListItem>
          <ListItem>Email-to-task links (tasks themselves will be kept but unlinked)</ListItem>
        </UnorderedList>
        <p style={{ marginTop: '1rem', color: 'var(--cds-support-error)' }}>
          This action cannot be undone. Your tasks will be preserved but will lose their company and email associations.
        </p>
      </Modal>
    </div>
  );
}
