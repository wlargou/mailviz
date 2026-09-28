import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PRIORITY_COLOR, PriorityBadge } from './PriorityBadge';

/**
 * High and Medium used to render the same yellow: `support-warning` and
 * `support-caution-minor` are both #f1c21b in g100.
 */
describe('PriorityBadge', () => {
  it('names the priority and marks it with a shape class and its colour', () => {
    const { container } = render(<PriorityBadge priority="HIGH" />);
    expect(screen.getByText('High')).toBeInTheDocument();
    const dot = container.querySelector('.priority-dot--high') as HTMLElement;
    expect(dot.style.getPropertyValue('--priority-color')).toBe(PRIORITY_COLOR.HIGH);
  });

  it('gives every priority a colour of its own', () => {
    expect(new Set(Object.values(PRIORITY_COLOR)).size).toBe(4);
  });

  it('never colours High with a token that is the same yellow as Medium in g100', () => {
    // support-warning and support-caution-minor are both yellow 30 there.
    expect(PRIORITY_COLOR.HIGH).not.toContain('support-warning');
    expect(PRIORITY_COLOR.HIGH).not.toContain('support-caution-minor');
  });
});
