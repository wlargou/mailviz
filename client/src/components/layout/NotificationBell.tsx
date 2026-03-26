import { useEffect, useRef, useCallback } from 'react';
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
} from '@carbon/icons-react';
import { formatDistanceToNow } from 'date-fns';
import { useNotificationStore } from '../../store/notificationStore';
import type { AppNotification } from '../../api/notifications';

// Icon mapping for notification types using Carbon icons
function getNotificationIcon(type: string) {
  const size = 18;
  if (type.includes('SHARED')) return <Share size={size} />;
  if (type.includes('ASSIGNED')) return <UserFollow size={size} />;
  if (type.startsWith('EMAIL')) return <Email size={size} />;
  if (type.startsWith('TASK')) return <Task size={size} />;
  if (type.startsWith('EVENT')) return <Calendar size={size} />;
  if (type.startsWith('DEAL')) return <Partnership size={size} />;
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

      switch (notification.entityType) {
        case 'email':
          navigate('/mail');
          break;
        case 'task':
          navigate('/tasks');
          break;
        case 'deal':
          navigate('/deals');
          break;
        case 'event':
          navigate('/calendar');
          break;
        default:
          break;
      }
    },
    [markRead, closePanel, navigate]
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
                  Clear all
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
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`notification-item${!n.isRead ? ' notification-item--unread' : ''}`}
                  onClick={() => handleNotificationClick(n)}
                >
                  <div
                    className="notification-item__indicator"
                    style={{ borderLeftColor: getNotificationColor(n.type) }}
                  />
                  <div className="notification-item__icon">
                    {getNotificationIcon(n.type)}
                  </div>
                  <div className="notification-item__content">
                    <span className="notification-item__title">{n.title}</span>
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
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
