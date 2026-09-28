import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HeaderGlobalAction } from '@carbon/react';
import {
  Notification,
  Close,
  Email,
  Task,
  Calendar,
  Partnership,
  Share,
  UserFollow,
  ChevronDown,
  ChevronRight,
  DocumentMultiple_01,
} from '@carbon/icons-react';
import { formatDistanceToNow } from 'date-fns';
import { useNotificationStore } from '../../store/notificationStore';
import type { AppNotification } from '../../api/notifications';
import { decodeEntities } from '../../utils/text';
import { groupNotifications, groupTarget, notificationTarget } from '../../utils/notificationGroups';

// Icon mapping for notification types using Carbon icons
function getNotificationIcon(type: string) {
  const size = 18;
  if (type.includes('SHARED')) return <Share size={size} />;
  if (type.includes('ASSIGNED')) return <UserFollow size={size} />;
  if (type.startsWith('EMAIL')) return <Email size={size} />;
  if (type.startsWith('TASK')) return <Task size={size} />;
  if (type.startsWith('EVENT')) return <Calendar size={size} />;
  if (type.startsWith('DEAL')) return <Partnership size={size} />;
  if (type.startsWith('RFP')) return <DocumentMultiple_01 size={size} />;
  return <Notification size={size} />;
}

function getNotificationColor(type: string): string {
  if (type.includes('OVERDUE') || type.includes('EXPIRED'))
    return 'var(--cds-support-error)';
  if (
    type.includes('DUE_SOON') ||
    type.includes('EXPIRING') ||
    type.includes('STARTING')
  )
    return 'var(--cds-support-warning)';
  return 'var(--cds-support-info)';
}

export function NotificationBell() {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    panelOpen,
    fetchNotifications,
    fetchUnreadCount,
    markRead,
    markAllRead,
    dismiss,
    dismissAll,
    togglePanel,
    closePanel,
  } = useNotificationStore();

  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch on mount and periodically
  useEffect(() => {
    fetchUnreadCount();
    fetchNotifications();
    const interval = setInterval(fetchUnreadCount, 60000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount, fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closePanel();
      }
    };
    if (panelOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [panelOpen, closePanel]);

  const handleNotificationClick = useCallback(
    (notification: AppNotification) => {
      markRead(notification.id);
      closePanel();
      const target = notificationTarget(notification);
      if (target) navigate(target);
    },
    [markRead, closePanel, navigate]
  );

  const sections = useMemo(() => groupNotifications(notifications), [notifications]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderItem = (n: AppNotification, nested = false) => (
    <div
      key={n.id}
      className={`notification-item${!n.isRead ? ' notification-item--unread' : ''}${nested ? ' notification-item--nested' : ''}`}
      onClick={() => handleNotificationClick(n)}
    >
      <div
        className="notification-item__indicator"
        style={{ borderLeftColor: getNotificationColor(n.type) }}
      />
      {!nested && (
        <div className="notification-item__icon">
          {getNotificationIcon(n.type)}
        </div>
      )}
      <div className="notification-item__content">
        <span className="notification-item__title">{decodeEntities(n.title)}</span>
        {n.message && (
          <span className="notification-item__message">
            {n.message}
          </span>
        )}
        <span className="notification-item__time">
          {formatDistanceToNow(new Date(n.createdAt), {
            addSuffix: true,
          })}
        </span>
      </div>
      <button
        className="notification-item__dismiss"
        onClick={(e) => {
          e.stopPropagation();
          dismiss(n.id);
        }}
        title="Dismiss"
      >
        <Close size={14} />
      </button>
    </div>
  );

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      <HeaderGlobalAction
        aria-label={panelOpen ? 'Close notifications' : 'Open notifications'}
        isActive={panelOpen}
        onClick={togglePanel}
      >
        {panelOpen ? <Close size={20} /> : <Notification size={20} />}
        {unreadCount > 0 && !panelOpen && (
          <span className="notification-badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </HeaderGlobalAction>

      {panelOpen && (
        <div className="notification-panel">
          <div className="notification-panel__header">
            <h4>Notifications</h4>
            <div className="notification-panel__actions">
              {notifications.some((n) => !n.isRead) && (
                <button
                  className="notification-panel__link"
                  onClick={() => markAllRead()}
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  className="notification-panel__link notification-panel__link--danger"
                  onClick={() => dismissAll()}
                >
                  {/* "Clear read": the action dismisses read notifications
                      only, and calling it "Clear all" promised something it
                      never did. */}
                  Clear read
                </button>
              )}
            </div>
          </div>

          <div className="notification-panel__list">
            {notifications.length === 0 ? (
              <div className="notification-panel__empty">
                <Notification size={32} />
                <p>No notifications</p>
              </div>
            ) : (
              sections.map((section) => (
                <section key={section.label} className="notification-section" aria-label={section.label}>
                  <h5 className="notification-section__label">{section.label}</h5>
                  {section.rows.map((row) => {
                    if (row.kind === 'single') return renderItem(row.notification);
                    const open = expanded.has(row.key);
                    const newest = row.items[0];
                    const unread = row.items.some((n) => !n.isRead);
                    const target = groupTarget(row.type);
                    return (
                      <div key={row.key} className="notification-group">
                        <div
                          role="button"
                          tabIndex={0}
                          aria-expanded={open}
                          className={`notification-item notification-item--group${unread ? ' notification-item--unread' : ''}`}
                          onClick={() => toggleGroup(row.key)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleGroup(row.key);
                            }
                          }}
                        >
                          <div
                            className="notification-item__indicator"
                            style={{ borderLeftColor: getNotificationColor(row.type) }}
                          />
                          <div className="notification-item__icon">
                            {getNotificationIcon(row.type)}
                          </div>
                          <div className="notification-item__content">
                            <span className="notification-item__title">{row.title}</span>
                            <span className="notification-item__message">
                              Latest: {decodeEntities(newest.title)}
                            </span>
                            <span className="notification-item__time">
                              {formatDistanceToNow(new Date(newest.createdAt), { addSuffix: true })}
                            </span>
                          </div>
                          <span className="notification-item__chevron" aria-hidden>
                            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </span>
                          <button
                            className="notification-item__dismiss"
                            onClick={(e) => {
                              e.stopPropagation();
                              row.items.forEach((n) => dismiss(n.id));
                            }}
                            title={`Dismiss all ${row.items.length}`}
                          >
                            <Close size={14} />
                          </button>
                        </div>
                        {open && (
                          <div className="notification-group__items">
                            {row.items.map((n) => renderItem(n, true))}
                            {target && (
                              <button
                                className="notification-panel__link notification-group__open"
                                onClick={() => {
                                  row.items.forEach((n) => { if (!n.isRead) markRead(n.id); });
                                  closePanel();
                                  navigate(target);
                                }}
                              >
                                Open the list
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
