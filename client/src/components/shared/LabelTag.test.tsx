import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LabelTag } from './LabelTag';
import type { Label } from '../../types/task';

/**
 * Label colour, from a stored hex to a Carbon tag type.
 *
 * The mapping has an explicit table and a dominant-channel fallback, and the
 * fallback is the hazard: it reads magenta60 as red (its red channel is the
 * largest) and teal60 as green. Both are plausible-looking answers, so the
 * only way to notice is to assert the rendered class.
 *
 * These pin the four labels onboarding seeds, because those are the ones a
 * user sees side by side on a single task row — two of them arriving the same
 * colour makes the column decorative rather than informative.
 */
function tagFor(color: string) {
  const label: Label = { id: 'l1', name: 'Sample', color } as Label;
  const { container } = render(<LabelTag label={label} />);
  const el = container.querySelector('[class*="cds--tag--"]');
  return Array.from(el?.classList ?? []).find((c) => c.startsWith('cds--tag--') && c !== 'cds--tag--sm');
}

describe('LabelTag colour mapping', () => {
  it.each([
    ['Billing', '#d02670', 'magenta'],
    ['Presales', '#0f62fe', 'blue'],
    ['Contract', '#8a3ffc', 'purple'],
    ['Support', '#007d79', 'teal'],
  ])('renders the seeded %s colour as a %s tag', (_name, hex, expected) => {
    expect(tagFor(hex)).toBe(`cds--tag--${expected}`);
  });

  it('gives the four seeded labels four different colours', () => {
    const types = ['#d02670', '#0f62fe', '#8a3ffc', '#007d79'].map(tagFor);

    expect(new Set(types).size).toBe(4);
  });

  it('still falls back for a colour it has never seen', () => {
    // The table is a set of known values, not a requirement — a user-picked
    // colour must still produce something rather than crashing.
    expect(tagFor('#ff0000')).toBeTruthy();
  });

  it('shows the label name', () => {
    render(<LabelTag label={{ id: 'l2', name: 'Billing', color: '#d02670' } as Label} />);

    expect(screen.getByText('Billing')).toBeInTheDocument();
  });
});
