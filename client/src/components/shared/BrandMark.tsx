import type { ReactNode } from 'react';
import { MARK_MIN_NODES, MARK_MIN_THRESHOLD_PX, MARK_NODES, MARK_VIEWBOX } from './brandMarkGeometry';
import type { MarkNode } from './brandMarkGeometry';

interface BrandMarkProps {
  /** Rendered size in px, both axes. */
  size?: number;
  /**
   * `auto` is the brand rule: the reduced glyph below 32px, the full mark at
   * 32px and above. Force one only when you know better than the rule.
   */
  variant?: 'auto' | 'full' | 'min';
  /**
   * An accessible name, for a mark that stands alone. Omitted, the mark is
   * `aria-hidden` — right wherever the product name is already beside it.
   */
  title?: string;
  className?: string;
}

const CENTRE = MARK_VIEWBOX / 2;

function renderNode(node: MarkNode, key: number): ReactNode {
  const className = `brand-mark__${node.role}`;
  switch (node.kind) {
    case 'ring':
      return (
        <circle
          key={key}
          className={`${className} brand-mark__ring`}
          cx={CENTRE}
          cy={CENTRE}
          r={node.r}
          fill="none"
          strokeWidth={node.width}
          strokeDasharray={node.dash}
          transform={node.rotate ? `rotate(${node.rotate} ${CENTRE} ${CENTRE})` : undefined}
        />
      );
    case 'line':
      return (
        <line
          key={key}
          className={className}
          x1={node.x1}
          y1={node.y1}
          x2={node.x2}
          y2={node.y2}
          strokeWidth={node.width}
          strokeLinecap="round"
        />
      );
    case 'rect':
      return (
        <rect
          key={key}
          className={className}
          x={node.x}
          y={node.y}
          width={node.size}
          height={node.size}
          transform={`rotate(45 ${CENTRE} ${CENTRE})`}
        />
      );
    case 'dot':
      return <circle key={key} className={className} cx={node.cx} cy={node.cy} r={node.r} />;
  }
}

/**
 * The Olympusx mark, theme-aware and static.
 *
 * Its two colours come from `--brand-primary` / `--brand-accent`, which
 * `styles/_brand.scss` sets on the Carbon theme classes, so inside a g10
 * `<Theme>` it is Blue 60 / Teal 40 and inside g100 Blue 50 / Teal 30 — the
 * design system's `-light` and `-dark` files — with nothing to swap.
 */
export function BrandMark({ size = 32, variant = 'auto', title, className }: BrandMarkProps) {
  const useMin = variant === 'min' || (variant === 'auto' && size < MARK_MIN_THRESHOLD_PX);
  const nodes = useMin ? MARK_MIN_NODES : MARK_NODES;

  return (
    <svg
      className={className ? `brand-mark ${className}` : 'brand-mark'}
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {nodes.map(renderNode)}
    </svg>
  );
}
