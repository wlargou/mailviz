import { Tag } from '@carbon/react';
import { CloudOffline } from '@carbon/icons-react';
import { useWebSocketStatus } from '../../hooks/useEmailWebSocket';

/**
 * Surfaces the shared WebSocket's connection state in the header.
 *
 * Renders nothing while connected — a permanent "you are online" badge is
 * noise. It only appears once real-time updates have actually stopped, which
 * matters because the app otherwise looks live while silently going stale:
 * the socket reconnects with exponential backoff (up to 30s) and nothing told
 * the user anything was wrong.
 */
export function ConnectionStatus() {
  const status = useWebSocketStatus();

  // 'connecting' is the very first connection attempt on page load. Flashing a
  // warning during normal startup would cry wolf, so only a genuine drop shows.
  if (status !== 'disconnected') return null;

  return (
    <Tag
      type="red"
      size="sm"
      renderIcon={CloudOffline}
      className="connection-status"
      title="Live updates are paused. Reconnecting automatically."
    >
      Reconnecting
    </Tag>
  );
}
