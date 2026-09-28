import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { PriorityBadge } from './PriorityBadge';

/**
 * High and Medium used to render the same yellow: `support-warning` and
 * `support-caution-minor` are both #f1c21b in g100. jsdom resolves no CSS
 * variables, so the colours are pinned where they are decided — in the
 * stylesheet — and the component is pinned to a class per priority.
 */
const scss = fs.readFileSync(path.resolve(__dirname, '../../styles/_base.scss'), 'utf8');

function tokenFor(priority: string): string {
  const block = scss.match(new RegExp(`\\.priority-dot--${priority}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  return block.match(/var\((--cds-[a-z-]+)\)/)?.[1] ?? '';
}

describe('PriorityBadge', () => {
  it('names the priority and marks it with its own class', () => {
    const { container } = render(<PriorityBadge priority="HIGH" />);
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(container.querySelector('.priority-dot--high')).not.toBeNull();
  });

  it('gives every priority a colour of its own', () => {
    const tokens = ['urgent', 'high', 'medium', 'low'].map(tokenFor);
    expect(tokens.every(Boolean)).toBe(true);
    expect(new Set(tokens).size).toBe(4);
  });

  it('never colours High with support-warning, the yellow Medium already uses in g100', () => {
    expect(tokenFor('high')).not.toBe('--cds-support-warning');
    expect(tokenFor('high')).not.toBe('--cds-support-caution-minor');
  });
});
