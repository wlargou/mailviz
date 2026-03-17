import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface TooltipState {
  text: string;
  x: number;
  y: number;
}

export function EventTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const handleMouseOver = useCallback((e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-tooltip]');
    if (target) {
      const rect = target.getBoundingClientRect();
      setTooltip({
        text: target.getAttribute('data-tooltip') || '',
        x: rect.left,
        y: rect.top - 4,
      });
    }
  }, []);

  const handleMouseOut = useCallback((e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-tooltip]');
    if (target) {
      setTooltip(null);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
    return () => {
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
    };
  }, [handleMouseOver, handleMouseOut]);

  if (!tooltip) return null;

  return createPortal(
    <div
      className="calendar-tooltip"
      style={{ left: tooltip.x, top: tooltip.y, transform: 'translateY(-100%)' }}
    >
      {tooltip.text}
    </div>,
    document.body
  );
}
