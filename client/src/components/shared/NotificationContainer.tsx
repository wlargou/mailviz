import { ToastNotification } from '@carbon/react';
import { useUIStore } from '../../store/uiStore';

export function NotificationContainer() {
  const { notifications, removeNotification } = useUIStore();

  if (notifications.length === 0) return null;

  return (
    <div className="notification-container">
      {notifications.map((n) => (
        <ToastNotification
          key={n.id}
          kind={n.kind}
          title={n.title}
          subtitle={n.subtitle}
          timeout={4000}
          onClose={() => removeNotification(n.id)}
        />
      ))}
    </div>
  );
}
