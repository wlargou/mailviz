import type { ReactElement } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { blue50, blue60, teal30, teal40 } from '@carbon/colors';
import { BrandMark } from './BrandMark';
import markDark from './brand-logos/olympusx-mark-dark.svg?raw';
import markLight from './brand-logos/olympusx-mark-light.svg?raw';
import glyphDark from './brand-logos/olympusx-glyph-dark.svg?raw';
import glyphLight from './brand-logos/olympusx-glyph-light.svg?raw';

/**
 * The design system says "use the files in Logos; never redraw it". BrandMark
 * draws the mark from data so it can follow the theme, so this is what keeps it
 * the files' mark: every node, in order, against the design system's own SVGs
 * (vendored unchanged in `brand-logos/`), geometry and colour role both.
 *
 * The colour side also pins the pairs `styles/_brand.scss` sets: a file whose
 * two colours were not exactly Carbon's Blue 50 / Teal 30 (dark) or Blue 60 /
 * Teal 40 (light) would fail the role lookup below.
 */

const GEOMETRY = [
  'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'x', 'y', 'width', 'height',
  'fill', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'transform',
] as const;

/** "18.70" and "18.7" are the same coordinate; anything else compares as text. */
function same(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) ? na === nb : a === b;
}

function shapes(root: Element): Element[] {
  return Array.from(root.children).filter((el) => el.tagName.toLowerCase() !== 'title');
}

function referenceShapes(svg: string): Element[] {
  return shapes(new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement);
}

/** The colour a reference node is painted in: its fill, or its stroke for an outline. */
function paint(el: Element): string {
  const fill = el.getAttribute('fill');
  return (fill && fill !== 'none' ? fill : el.getAttribute('stroke') ?? '').toLowerCase();
}

function expectSameMark(rendered: Element[], reference: Element[], roles: Record<string, string>) {
  expect(rendered).toHaveLength(reference.length);
  reference.forEach((ref, i) => {
    const node = rendered[i];
    expect(node.tagName.toLowerCase(), `node ${i}`).toBe(ref.tagName.toLowerCase());
    for (const attr of GEOMETRY) {
      // `fill` is geometry only where it means "outline": the colours come from CSS.
      if (attr === 'fill' && ref.getAttribute('fill') !== 'none') continue;
      expect(same(node.getAttribute(attr), ref.getAttribute(attr)), `node ${i} ${attr}: ${node.getAttribute(attr)} vs ${ref.getAttribute(attr)}`).toBe(true);
    }
    const role = roles[paint(ref)];
    expect(role, `node ${i} is painted ${paint(ref)}, which is neither brand colour`).toBeDefined();
    expect(node.classList.contains(`brand-mark__${role}`), `node ${i} role ${role}`).toBe(true);
  });
}

function renderedShapes(ui: ReactElement): Element[] {
  const { container } = render(ui);
  return shapes(container.querySelector('svg')!);
}

const DARK = { [blue50]: 'primary', [teal30]: 'accent' };
const LIGHT = { [blue60]: 'primary', [teal40]: 'accent' };

describe('BrandMark', () => {
  it('draws the full mark exactly as the design system files do', () => {
    const rendered = renderedShapes(<BrandMark size={200} variant="full" />);

    expect(rendered).toHaveLength(39);
    expectSameMark(rendered, referenceShapes(markDark), DARK);
    expectSameMark(rendered, referenceShapes(markLight), LIGHT);
  });

  it('draws the reduced glyph exactly as the design system files do', () => {
    const rendered = renderedShapes(<BrandMark size={24} variant="min" />);

    expect(rendered).toHaveLength(9);
    expectSameMark(rendered, referenceShapes(glyphDark), DARK);
    expectSameMark(rendered, referenceShapes(glyphLight), LIGHT);
  });

  it('follows the brand rule: the glyph below 32px, the full mark from 32px', () => {
    expect(renderedShapes(<BrandMark size={31} />)).toHaveLength(9);
    expect(renderedShapes(<BrandMark size={32} />)).toHaveLength(39);
  });

  it('is decoration beside the name, and an image when it stands alone', () => {
    const { container, unmount } = render(<BrandMark size={24} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    unmount();

    render(<BrandMark size={48} title="Olympusx" />);
    expect(screen.getByRole('img', { name: 'Olympusx' })).toBeInTheDocument();
  });
});
