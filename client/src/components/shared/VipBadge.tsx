import { StarFilled, Star } from '@carbon/icons-react';

interface VipBadgeProps {
  isVip: boolean;
  onToggle?: () => void;
  size?: number;
}

export function VipBadge({ isVip, onToggle, size = 16 }: VipBadgeProps) {
  if (!isVip && !onToggle) return null;

  const className = onToggle
    ? 'vip-star vip-star--clickable'
    : 'vip-star';

  const Icon = isVip ? StarFilled : Star;

  return (
    <Icon
      size={size}
      className={className}
      onClick={(e) => {
        if (onToggle) {
          e.stopPropagation();
          onToggle();
        }
      }}
      title={isVip ? 'VIP' : 'Mark as VIP'}
    />
  );
}
