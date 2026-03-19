import { useEffect, useState, useCallback } from 'react';
import { Button, InlineLoading, InlineNotification, TextInput, Tag } from '@carbon/react';
import { Checkmark, Misuse, Renew, WarningAlt, Add, TrashCan, Edit } from '@carbon/icons-react';
import { useSearchParams } from 'react-router-dom';
import { authApi } from '../../api/auth';
import { taskStatusesApi } from '../../api/taskStatuses';
import { useUIStore } from '../../store/uiStore';
import type { TaskStatusConfig } from '../../types/task';
import type { GoogleStatus } from '../../types/calendar';
import { format } from 'date-fns';

export function SettingsPage() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingMail, setSyncingMail] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const addNotification = useUIStore((s) => s.addNotification);
  const [searchParams, setSearchParams] = useSearchParams();

  const [taskStatuses, setTaskStatuses] = useState<TaskStatusConfig[]>([]);
  const [newStatusLabel, setNewStatusLabel] = useState('');
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const fetchTaskStatuses = useCallback(async () => {
    try {
      const { data: res } = await taskStatusesApi.getAll();
      setTaskStatuses(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchTaskStatuses();
  }, []);

  useEffect(() => {
    if (searchParams.get('connected') === 'true') {
      addNotification({ kind: 'success', title: 'Google account connected successfully' });
      setSearchParams({}, { replace: true });
      fetchStatus();
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
      addNotification({
        kind: 'success',
        title: 'Calendar synced',
        subtitle: parts.join(' · '),
      });
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
      addNotification({
        kind: 'success',
        title: 'Gmail synced',
        subtitle: parts.join(' · '),
      });
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

  return (
    <div>
      <div className="page-header">
        <div className="page-header__info">
          <h1>Settings</h1>
          <p className="page-header__subtitle">Manage your integrations and preferences</p>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card__header">
          <div className="settings-card__icon">
            <svg viewBox="0 0 24 24" width="24" height="24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
          </div>
          <div>
            <h3 className="settings-card__title">Google Account</h3>
            <p className="settings-card__desc">
              Connect your Google account to sync calendar events and emails
            </p>
          </div>
        </div>

        <div className="settings-card__body">
          {loading ? (
            <InlineLoading description="Checking connection..." />
          ) : status?.connected ? (
            <div className="settings-connected">
              <div className="settings-connected__info">
                <div className="settings-connected__badge">
                  <Checkmark size={16} />
                  <span>Connected</span>
                </div>
                {status.email && (
                  <p className="settings-connected__email">{status.email}</p>
                )}
              </div>
              {status.needsReauth && (
                <InlineNotification
                  kind="warning"
                  title="Permissions upgrade needed"
                  subtitle="Reconnect Google to enable email actions (archive, trash, mark read)."
                  lowContrast
                  hideCloseButton
                  style={{ marginBottom: '0.5rem' }}
                />
              )}

              {/* Sync status & actions */}
              <div className="settings-sync-sections">
                <div className="settings-sync-row">
                  <div className="settings-sync-row__info">
                    <span className="settings-sync-row__label">Calendar</span>
                    {status.lastSyncAt && (
                      <span className="settings-sync-row__time">
                        Last synced {format(new Date(status.lastSyncAt), 'MMM d, h:mm a')}
                      </span>
                    )}
                  </div>
                  <Button
                    kind="tertiary"
                    size="sm"
                    renderIcon={Renew}
                    onClick={handleSync}
                    disabled={syncing}
                  >
                    {syncing ? 'Syncing...' : 'Sync Calendar'}
                  </Button>
                </div>

                <div className="settings-sync-row">
                  <div className="settings-sync-row__info">
                    <span className="settings-sync-row__label">Gmail</span>
                    {status.lastMailSyncAt && (
                      <span className="settings-sync-row__time">
                        Last synced {format(new Date(status.lastMailSyncAt), 'MMM d, h:mm a')}
                      </span>
                    )}
                    {!status.lastMailSyncAt && (
                      <span className="settings-sync-row__time">
                        Auto-syncs every 60s
                      </span>
                    )}
                  </div>
                  <Button
                    kind="tertiary"
                    size="sm"
                    renderIcon={Renew}
                    onClick={handleMailSync}
                    disabled={syncingMail}
                  >
                    {syncingMail ? 'Syncing...' : 'Sync Email'}
                  </Button>
                </div>
              </div>

              <div className="settings-connected__actions" style={{ marginTop: '1rem' }}>
                {status.needsReauth ? (
                  <Button
                    kind="primary"
                    size="sm"
                    renderIcon={WarningAlt}
                    onClick={handleConnect}
                  >
                    Reconnect Google
                  </Button>
                ) : (
                  <Button
                    kind="danger--tertiary"
                    size="sm"
                    renderIcon={Misuse}
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="settings-disconnected">
              <p>No Google account connected. Connect to sync your calendar and emails.</p>
              <Button
                kind="primary"
                size="md"
                onClick={handleConnect}
              >
                Connect Google Account
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Task Statuses Management */}
      <div className="settings-card" style={{ marginTop: '1.5rem' }}>
        <div className="settings-card__header">
          <h3>Task Statuses</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--cds-text-secondary)', margin: '0.25rem 0 0' }}>
            Manage the status columns for your task Kanban board
          </p>
        </div>
        <div className="settings-card__body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {taskStatuses.map((s) => (
              <div key={s.id} className="settings-status-row">
                <span className="settings-status-row__indicator" style={{ backgroundColor: s.color }} />
                {editingStatusId === s.id ? (
                  <TextInput
                    id={`edit-status-${s.id}`}
                    labelText=""
                    size="sm"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter' && editLabel.trim()) {
                        await taskStatusesApi.update(s.id, { label: editLabel.trim() });
                        setEditingStatusId(null);
                        fetchTaskStatuses();
                      }
                      if (e.key === 'Escape') setEditingStatusId(null);
                    }}
                    autoFocus
                    style={{ flex: 1 }}
                  />
                ) : (
                  <span className="settings-status-row__label">{s.label}</span>
                )}
                <Tag size="sm" type="cool-gray">{s.name}</Tag>
                <Button
                  kind="ghost"
                  size="sm"
                  hasIconOnly
                  iconDescription="Edit"
                  renderIcon={Edit}
                  onClick={() => {
                    setEditingStatusId(s.id);
                    setEditLabel(s.label);
                  }}
                />
                <Button
                  kind="ghost"
                  size="sm"
                  hasIconOnly
                  iconDescription="Delete"
                  renderIcon={TrashCan}
                  onClick={async () => {
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
                  }}
                />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', alignItems: 'flex-end' }}>
            <TextInput
              id="new-status-label"
              labelText="New status"
              placeholder="e.g. Orders, Delivery..."
              size="sm"
              value={newStatusLabel}
              onChange={(e) => setNewStatusLabel(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newStatusLabel.trim()) {
                  try {
                    await taskStatusesApi.create({ label: newStatusLabel.trim() });
                    setNewStatusLabel('');
                    fetchTaskStatuses();
                    addNotification({ kind: 'success', title: 'Status created' });
                  } catch {
                    addNotification({ kind: 'error', title: 'Failed to create status' });
                  }
                }
              }}
            />
            <Button
              kind="primary"
              size="sm"
              renderIcon={Add}
              disabled={!newStatusLabel.trim()}
              onClick={async () => {
                try {
                  await taskStatusesApi.create({ label: newStatusLabel.trim() });
                  setNewStatusLabel('');
                  fetchTaskStatuses();
                  addNotification({ kind: 'success', title: 'Status created' });
                } catch {
                  addNotification({ kind: 'error', title: 'Failed to create status' });
                }
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
