import { ActionableNotification, ToastNotification } from '@carbon/react';
import { useUIStore } from '../../store/uiStore';

export function NotificationContainer() {
  const { notifications, removeNotification } = useUIStore();

  if (notifications.length === 0) return null;

  return (
    <div className="notification-container">
      {notifications.map((n) =>
        n.action ? (
          // A toast with an offer on it. It does not time out: an offer that
          // vanishes while the user reads it is worse than no offer.
          <ActionableNotification
            key={n.id}
            kind={n.kind}
            title={n.title}
            subtitle={n.subtitle}
            actionButtonLabel={n.action.label}
            onActionButtonClick={() => {
              n.action!.onClick();
              removeNotification(n.id);
            }}
            onClose={() => {
              removeNotification(n.id);
              return false;
            }}
          />
        ) : (
          <ToastNotification
            key={n.id}
            kind={n.kind}
            title={n.title}
            subtitle={n.subtitle}
            timeout={4000}
            onClose={() => removeNotification(n.id)}
          />
        )
      )}
    </div>
  );
}
