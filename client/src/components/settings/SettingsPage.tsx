import { useEffect, useState, useCallback } from 'react';
import {
  Button,
  InlineLoading,
  InlineNotification,
  TextInput,
  Tag,
  Tile,
  Stack,
  StructuredListWrapper,
  StructuredListHead,
  StructuredListBody,
  StructuredListRow,
  StructuredListCell,
  Layer,
  Grid,
  Column,
  Modal,
  UnorderedList,
  ListItem,
  ProgressBar,
} from '@carbon/react';
import {
  Checkmark,
  Misuse,
  Renew,
  WarningAlt,
  Add,
  TrashCan,
  Edit,
  LogoGoogle,
  Calendar,
  Email,
} from '@carbon/icons-react';
import { useSearchParams } from 'react-router-dom';
import { authApi } from '../../api/auth';
import { taskStatusesApi } from '../../api/taskStatuses';
import { companyCategoriesApi } from '../../api/companyCategories';
import { useUIStore } from '../../store/uiStore';
import type { TaskStatusConfig } from '../../types/task';
import type { CompanyCategory } from '../../types/customer';
import type { GoogleStatus } from '../../types/calendar';
import { format } from 'date-fns';

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

export function SettingsPage() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingMail, setSyncingMail] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [emailProgress, setEmailProgress] = useState<{ synced: number; total: number; phase: string } | null>(null);
  const [calendarProgress, setCalendarProgress] = useState<{ synced: number; total: number; phase: string } | null>(null);
  const addNotification = useUIStore((s) => s.addNotification);
  const [searchParams, setSearchParams] = useSearchParams();

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

  useEffect(() => {
    fetchStatus();
    fetchTaskStatuses();
    fetchCategories();
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
    } catch {
      addNotification({ kind: 'error', title: 'Email sync failed' });
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

  const handleAddStatus = async () => {
    if (!newStatusLabel.trim()) return;
    try {
      await taskStatusesApi.create({ label: newStatusLabel.trim() });
      setNewStatusLabel('');
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

  const handleSaveEditStatus = async (id: string) => {
    if (!editLabel.trim()) return;
    await taskStatusesApi.update(id, { label: editLabel.trim() });
    setEditingStatusId(null);
    fetchTaskStatuses();
  };

  const handleAddCategory = async () => {
    if (!newCategoryLabel.trim()) return;
    try {
      await companyCategoriesApi.create({ label: newCategoryLabel.trim() });
      setNewCategoryLabel('');
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

  const handleSaveEditCategory = async (id: string) => {
    if (!editCategoryLabel.trim()) return;
    await companyCategoriesApi.update(id, { label: editCategoryLabel.trim() });
    setEditingCategoryId(null);
    fetchCategories();
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
        <Column lg={10} md={8} sm={4}>
      <Stack gap={7}>
        {/* ─── Google Integration ─── */}
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
                        emailProgress && emailProgress.total > 0 ? (
                          <div style={{ minWidth: '180px' }}>
                            <ProgressBar
                              label={`${emailProgress.synced} / ${emailProgress.total} emails`}
                              helperText="Syncing emails..."
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

        {/* ─── Task Statuses ─── */}
        <Tile className="settings-tile">
          <Stack gap={5}>
            <div className="settings-tile__header">
              <div className="settings-tile__icon">
                <svg viewBox="0 0 32 32" width="20" height="20" fill="var(--cds-icon-primary)">
                  <path d="M14 21.414l-5-5L10.413 15 14 18.586 21.585 11 23 12.414z" />
                  <path d="M16 2a14 14 0 1014 14A14 14 0 0016 2zm0 26a12 12 0 1112-12 12 12 0 01-12 12z" />
                </svg>
              </div>
              <div>
                <h4 className="settings-tile__title">Task Statuses</h4>
                <p className="settings-tile__desc">Manage the columns for your Kanban board</p>
              </div>
            </div>

            <StructuredListWrapper isCondensed>
              <StructuredListHead>
                <StructuredListRow head>
                  <StructuredListCell head>Color</StructuredListCell>
                  <StructuredListCell head>Label</StructuredListCell>
                  <StructuredListCell head>Key</StructuredListCell>
                  <StructuredListCell head>{''}</StructuredListCell>
                </StructuredListRow>
              </StructuredListHead>
              <StructuredListBody>
                {taskStatuses.map((s) => (
                  <StructuredListRow key={s.id}>
                    <StructuredListCell>
                      <div className="settings-color-swatch-wrapper">
                        <button
                          className="settings-status-dot"
                          style={{ backgroundColor: s.color }}
                          title="Change color"
                          onClick={() => setColorPickerOpen(colorPickerOpen === s.id ? null : s.id)}
                        />
                        {colorPickerOpen === s.id && (
                          <div className="settings-color-popover">
                            {STATUS_COLORS.map((c) => (
                              <button
                                key={c.hex}
                                className={`settings-color-option${s.color === c.hex ? ' settings-color-option--selected' : ''}`}
                                style={{ backgroundColor: c.hex }}
                                title={c.label}
                                onClick={async () => {
                                  setTaskStatuses((prev) =>
                                    prev.map((ts) => ts.id === s.id ? { ...ts, color: c.hex } : ts)
                                  );
                                  setColorPickerOpen(null);
                                  try {
                                    await taskStatusesApi.update(s.id, { color: c.hex });
                                  } catch {
                                    fetchTaskStatuses();
                                  }
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </StructuredListCell>
                    <StructuredListCell>
                      {editingStatusId === s.id ? (
                        <TextInput
                          id={`edit-status-${s.id}`}
                          labelText=""
                          hideLabel
                          size="sm"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEditStatus(s.id);
                            if (e.key === 'Escape') setEditingStatusId(null);
                          }}
                          onBlur={() => handleSaveEditStatus(s.id)}
                          autoFocus
                        />
                      ) : (
                        <span>{s.label}</span>
                      )}
                    </StructuredListCell>
                    <StructuredListCell>
                      <Tag size="sm" type="cool-gray">{s.name}</Tag>
                    </StructuredListCell>
                    <StructuredListCell>
                      <div className="settings-status-actions">
                        <Button kind="ghost" size="sm" hasIconOnly iconDescription="Rename" renderIcon={Edit}
                          onClick={() => { setEditingStatusId(s.id); setEditLabel(s.label); }}
                        />
                        <Button kind="ghost" size="sm" hasIconOnly iconDescription="Delete" renderIcon={TrashCan}
                          onClick={() => handleDeleteStatus(s)}
                        />
                      </div>
                    </StructuredListCell>
                  </StructuredListRow>
                ))}
              </StructuredListBody>
            </StructuredListWrapper>

            <div className="settings-status-add">
              <TextInput
                id="new-status-label"
                labelText="Add new status"
                placeholder="e.g. Orders, Delivery..."
                size="sm"
                value={newStatusLabel}
                onChange={(e) => setNewStatusLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddStatus(); }}
              />
              <Button kind="primary" size="sm" renderIcon={Add} disabled={!newStatusLabel.trim()} onClick={handleAddStatus}>
                Add
              </Button>
            </div>
          </Stack>
        </Tile>

        {/* ─── Company Categories ─── */}
        <Tile className="settings-tile">
          <Stack gap={5}>
            <div className="settings-tile__header">
              <div className="settings-tile__icon">
                <svg viewBox="0 0 32 32" width="20" height="20" fill="var(--cds-icon-primary)">
                  <path d="M28 12h-8V4h8zm-6-2h4V6h-4zM17 15H9V7h8zM11 13h4V9h-4zM28 26h-8v-8h8zm-6-2h4v-4h-4zM17 26H9v-8h8zm-6-2h4v-4h-4z" />
                </svg>
              </div>
              <div>
                <h4 className="settings-tile__title">Company Categories</h4>
                <p className="settings-tile__desc">Categorize your companies (e.g. Customers, Distributors, Partners)</p>
              </div>
            </div>

            <StructuredListWrapper isCondensed>
              <StructuredListHead>
                <StructuredListRow head>
                  <StructuredListCell head>Color</StructuredListCell>
                  <StructuredListCell head>Label</StructuredListCell>
                  <StructuredListCell head>Key</StructuredListCell>
                  <StructuredListCell head>{''}</StructuredListCell>
                </StructuredListRow>
              </StructuredListHead>
              <StructuredListBody>
                {categories.map((c) => (
                  <StructuredListRow key={c.id}>
                    <StructuredListCell>
                      <div className="settings-color-swatch-wrapper">
                        <button
                          className="settings-status-dot"
                          style={{ backgroundColor: c.color }}
                          title="Change color"
                          onClick={() => setCategoryColorPickerOpen(categoryColorPickerOpen === c.id ? null : c.id)}
                        />
                        {categoryColorPickerOpen === c.id && (
                          <div className="settings-color-popover">
                            {STATUS_COLORS.map((sc) => (
                              <button
                                key={sc.hex}
                                className={`settings-color-option${c.color === sc.hex ? ' settings-color-option--selected' : ''}`}
                                style={{ backgroundColor: sc.hex }}
                                title={sc.label}
                                onClick={async () => {
                                  setCategories((prev) =>
                                    prev.map((cat) => cat.id === c.id ? { ...cat, color: sc.hex } : cat)
                                  );
                                  setCategoryColorPickerOpen(null);
                                  try {
                                    await companyCategoriesApi.update(c.id, { color: sc.hex });
                                  } catch {
                                    fetchCategories();
                                  }
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </StructuredListCell>
                    <StructuredListCell>
                      {editingCategoryId === c.id ? (
                        <TextInput
                          id={`edit-category-${c.id}`}
                          labelText=""
                          hideLabel
                          size="sm"
                          value={editCategoryLabel}
                          onChange={(e) => setEditCategoryLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEditCategory(c.id);
                            if (e.key === 'Escape') setEditingCategoryId(null);
                          }}
                          onBlur={() => handleSaveEditCategory(c.id)}
                          autoFocus
                        />
                      ) : (
                        <span>{c.label}</span>
                      )}
                    </StructuredListCell>
                    <StructuredListCell>
                      <Tag size="sm" type="cool-gray">{c.name}</Tag>
                    </StructuredListCell>
                    <StructuredListCell>
                      <div className="settings-status-actions">
                        <Button kind="ghost" size="sm" hasIconOnly iconDescription="Rename" renderIcon={Edit}
                          onClick={() => { setEditingCategoryId(c.id); setEditCategoryLabel(c.label); }}
                        />
                        <Button kind="ghost" size="sm" hasIconOnly iconDescription="Delete" renderIcon={TrashCan}
                          onClick={() => handleDeleteCategory(c)}
                        />
                      </div>
                    </StructuredListCell>
                  </StructuredListRow>
                ))}
              </StructuredListBody>
            </StructuredListWrapper>

            <div className="settings-status-add">
              <TextInput
                id="new-category-label"
                labelText="Add new category"
                placeholder="e.g. Vendors, Agencies..."
                size="sm"
                value={newCategoryLabel}
                onChange={(e) => setNewCategoryLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }}
              />
              <Button kind="primary" size="sm" renderIcon={Add} disabled={!newCategoryLabel.trim()} onClick={handleAddCategory}>
                Add
              </Button>
            </div>
          </Stack>
        </Tile>
      </Stack>
        </Column>
      </Grid>

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
