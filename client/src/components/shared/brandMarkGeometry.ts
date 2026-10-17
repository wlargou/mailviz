/**
 * The Olympusx mark (the Sovereign Cross), as data.
 *
 * Ported from Support Hub's `markGeometry.ts`, which took it from the console.
 * The design system's rule is "use the files in Logos; never redraw it", and
 * this is not a redraw: the coordinates are the files' own, and
 * `BrandMark.test.tsx` compares every node against the design system's
 * `olympusx-mark-*` and `olympusx-glyph-*` files, vendored beside it in
 * `brand-logos/`, so a hand edit here goes red.
 *
 * Why data and not those files: the files differ only in their two hex values,
 * and an <img> cannot inherit a theme. As data, each node names the colour ROLE
 * it carries and the role resolves to a custom property the Carbon theme sets
 * (`styles/_brand.scss`), so the mark follows the g100/g10 toggle like every
 * other surface, with no src swap.
 */

/** The two colours the artwork uses, resolved per theme. */
export type MarkRole = 'primary' | 'accent';

export type MarkNode = { role: MarkRole } & (
  | { kind: 'ring'; r: number; width: number; dash: string; rotate?: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number }
  | { kind: 'rect'; x: number; y: number; size: number }
  | { kind: 'dot'; cx: number; cy: number; r: number }
);

/** The 200 × 200 box every node is expressed in. */
export const MARK_VIEWBOX = 200;

/**
 * The brand rule: the full mark at 32px and above, the reduced glyph below,
 * where the orbit dots and the thin bands collapse into mud.
 */
export const MARK_MIN_THRESHOLD_PX = 32;

const dots = (role: MarkRole, r: number, points: readonly (readonly [number, number])[]): MarkNode[] =>
  points.map(([cx, cy]) => ({ kind: 'dot', role, cx, cy, r }));

const lines = (
  role: MarkRole,
  width: number,
  segments: readonly (readonly [number, number, number, number])[],
): MarkNode[] => segments.map(([x1, y1, x2, y2]) => ({ kind: 'line', role, x1, y1, x2, y2, width }));

/** The full mark: 39 nodes, in the files' order. */
export const MARK_NODES: readonly MarkNode[] = [
  { kind: 'ring', role: 'accent', r: 62, width: 1.5, dash: '9 11', rotate: 11 },
  { kind: 'ring', role: 'primary', r: 34, width: 2, dash: '14 7' },
  // The four members (the thick X).
  ...lines('primary', 6, [
    [152.33, 47.67, 112.73, 87.27],
    [152.33, 152.33, 112.73, 112.73],
    [47.67, 152.33, 87.27, 112.73],
    [47.67, 47.67, 87.27, 87.27],
  ]),
  // The four thin cardinal spokes.
  ...lines('accent', 2, [
    [100, 48, 100, 76],
    [152, 100, 124, 100],
    [100, 152, 100, 124],
    [48, 100, 76, 100],
  ]),
  // The core.
  { kind: 'rect', role: 'primary', x: 90, y: 90, size: 20 },
  // The outer orbit: four axis dots, then twelve small ones.
  ...dots('primary', 3.5, [
    [100, 12],
    [188, 100],
    [100, 188],
    [12, 100],
  ]),
  ...dots('accent', 2, [
    [133.68, 18.7],
    [162.23, 37.77],
    [181.3, 66.32],
    [181.3, 133.68],
    [162.23, 162.23],
    [133.68, 181.3],
    [66.32, 181.3],
    [37.77, 162.23],
    [18.7, 133.68],
    [18.7, 66.32],
    [37.77, 37.77],
    [66.32, 18.7],
  ]),
  // The dots capping the members, midway along them, and capping the spokes.
  ...dots('primary', 5.5, [
    [152.33, 47.67],
    [152.33, 152.33],
    [47.67, 152.33],
    [47.67, 47.67],
  ]),
  ...dots('accent', 3.5, [
    [133.94, 66.06],
    [133.94, 133.94],
    [66.06, 133.94],
    [66.06, 66.06],
  ]),
  ...dots('accent', 2.8, [
    [100, 48],
    [152, 100],
    [100, 152],
    [48, 100],
  ]),
];

/** The reduced glyph: 9 nodes, heavier strokes, no orbit. Below 32px. */
export const MARK_MIN_NODES: readonly MarkNode[] = [
  ...lines('primary', 14, [
    [150.91, 49.09, 115.56, 84.44],
    [150.91, 150.91, 115.56, 115.56],
    [49.09, 150.91, 84.44, 115.56],
    [49.09, 49.09, 84.44, 84.44],
  ]),
  { kind: 'rect', role: 'primary', x: 83, y: 83, size: 34 },
  ...dots('accent', 9, [
    [100, 20],
    [180, 100],
    [100, 180],
    [20, 100],
  ]),
];
