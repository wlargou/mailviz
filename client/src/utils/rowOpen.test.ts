import { describe, it, expect, vi } from 'vitest';
import type { MouseEvent } from 'react';
import { openRowOnClick } from './rowOpen';

function clickOn(el: HTMLElement) {
  return { target: el } as unknown as MouseEvent<HTMLElement>;
}

describe('openRowOnClick', () => {
  it('opens on a click in plain row content', () => {
    const open = vi.fn();
    const cell = document.createElement('td');
    cell.appendChild(document.createElement('span'));
    openRowOnClick(open)(clickOn(cell.firstChild as HTMLElement));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('leaves controls in the row to do their own thing', () => {
    const open = vi.fn();
    const handler = openRowOnClick(open);
    for (const html of [
      '<button><svg><path/></svg></button>',
      '<a href="#">x</a>',
      '<input type="checkbox">',
      '<div class="cds--overflow-menu"><span>⋯</span></div>',
      '<div class="clickable-tag"><span>Acme</span></div>',
      '<div role="menuitem">Delete</div>',
    ]) {
      const host = document.createElement('td');
      host.innerHTML = html;
      // The innermost element, as a real click would target.
      let target = host.firstElementChild as HTMLElement;
      while (target.firstElementChild) target = target.firstElementChild as HTMLElement;
      handler(clickOn(target));
    }
    expect(open).not.toHaveBeenCalled();
  });
});
