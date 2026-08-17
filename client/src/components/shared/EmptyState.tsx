import { TaskComplete } from '@carbon/icons-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  /** Defaults to a checkmark at `md`. Pass `null` to suppress it entirely. */
  icon?: React.ReactNode;
  action?: React.ReactNode;
  /**
   * `md` (default) is the full treatment — dashed border, circular icon — for an
   * empty page or panel. `sm` is the dense variant for a dashboard card, where
   * the bordered box would be larger than the card holding it.
   */
  size?: 'sm' | 'md';
}

/**
 * The one empty state.
 *
 * There used to be two markup families: this component, used by ten places, and
 * an ad-hoc `.card-empty` div used by all five dashboard cards and the Review
 * flow. They existed in parallel because the cards genuinely needed something
 * denser, not because anyone wanted two — so density is now a prop.
 *
 * At `sm` the icon is omitted unless one is asked for: in a card the text is the
 * whole message, and a decorative circle above two words reads as clutter.
 */
export function EmptyState({ title, description, icon, action, size = 'md' }: EmptyStateProps) {
  const showIcon = icon !== null && (icon !== undefined || size === 'md');

  return (
    <div className={`empty-state${size === 'sm' ? ' empty-state--sm' : ''}`}>
      {showIcon && <div className="empty-state__icon">{icon ?? <TaskComplete size={20} />}</div>}
      <h4>{title}</h4>
      {description && <p>{description}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
