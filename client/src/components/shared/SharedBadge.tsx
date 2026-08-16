import { Tag } from '@carbon/react';
import { Share } from '@carbon/icons-react';
import { useAuthStore } from '../../store/authStore';

interface SharedBadgeProps {
  /**
   * The owner of the record — the `userId` column on tasks, deals and threads.
   * Anything the current user can see but does not own reached them through a
   * share (or an assignment), so it gets the badge.
   */
  ownerId: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * "Shared with me" marker for list rows and Kanban cards.
 *
 * Renders nothing for records the signed-in user owns, so callers can drop it
 * in unconditionally.
 */
export function SharedBadge({ ownerId, size = 'sm' }: SharedBadgeProps) {
  const currentUserId = useAuthStore((s) => s.user?.id);

  if (!currentUserId || !ownerId || ownerId === currentUserId) return null;

  return (
    <Tag type="teal" size={size} renderIcon={Share} className="shared-badge">
      Shared
    </Tag>
  );
}
