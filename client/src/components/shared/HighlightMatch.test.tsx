import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HighlightMatch } from './HighlightMatch';

const bold = (container: HTMLElement) => [...container.querySelectorAll('strong')].map((s) => s.textContent);

describe('HighlightMatch', () => {
  it('bolds every word of the query, in whatever order the text has them', () => {
    const { container } = render(<HighlightMatch text="ALAMI Omar <o.alami@bkam.ma>" query="omar alami" />);
    expect(bold(container)).toEqual(['ALAMI', 'Omar', 'alami']);
    expect(container.textContent).toBe('ALAMI Omar <o.alami@bkam.ma>');
  });

  it('skips single letters, and prefers the longer of two overlapping words', () => {
    const letters = render(<HighlightMatch text="a b c" query="a" />);
    expect(bold(letters.container)).toEqual([]);
    const overlap = render(<HighlightMatch text="alami" query="al alami" />);
    expect(bold(overlap.container)).toEqual(['alami']);
  });

  it('reads regex characters as text', () => {
    const { container } = render(<HighlightMatch text="Offre (v2) finale" query="(v2)" />);
    expect(bold(container)).toEqual(['(v2)']);
  });
});
