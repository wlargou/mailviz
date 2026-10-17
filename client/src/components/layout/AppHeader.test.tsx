import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AppHeader } from './AppHeader';

/**
 * The header carries the product's name twice: the full name as the banner's
 * label, and the short one beside the glyph, where the full name does not fit.
 * The strings are written out here rather than read from `src/brand.ts`, so a
 * change to the name has to be made on purpose in both places.
 */

// The bar's own widgets fetch and subscribe; none of that is under test here.
vi.mock('./GlobalSearch', () => ({ GlobalSearch: () => null }));
vi.mock('./NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('./ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../../api/auth', () => ({ fetchServerVersion: vi.fn() }));
// The About dialog is mounted (closed) inside the header; Vite substitutes this.
vi.stubGlobal('__APP_VERSION__', '1.0.0.0');

describe('AppHeader', () => {
  it('is labelled with the full product name', () => {
    render(<AppHeader />);

    expect(screen.getByRole('banner', { name: 'Olympusx Productivity Hub' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Olympusx Productivity Hub' })).toBeInTheDocument();
  });

  it('end-aligns the About tooltip, which carries the full name, so it stays inside the window', () => {
    render(<AppHeader />);

    // Centred, a ~250px tooltip on a button 120px from the right edge runs past
    // it. Carbon spells the alignment as a class on the popover container:
    // `bottom` when centred, `bottom-end` when aligned to the button's end.
    const about = screen.getByRole('button', { name: 'About Olympusx Productivity Hub' });
    const popover = about.closest('.cds--popover-container');
    expect(popover).toHaveClass('cds--popover--bottom-end');
    expect(popover).not.toHaveClass('cds--popover--bottom');
  });

  it('shows the glyph and the short name, at the name weight, linking home', () => {
    render(<AppHeader />);

    const home = screen.getByRole('link', { name: 'Productivity Hub' });
    expect(home).toHaveAttribute('href', '/');
    // The 24px glyph, as decoration: the name beside it is what is read out.
    const mark = home.querySelector('svg.brand-mark');
    expect(mark).toHaveAttribute('width', '24');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    // `.brand-name` is what sets the wordmark's 400 over Carbon's 600.
    expect(within(home).getByText('Productivity Hub')).toHaveClass('brand-name');
  });
});
