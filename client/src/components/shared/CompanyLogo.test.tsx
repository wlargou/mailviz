import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompanyLogo } from './CompanyLogo';

/**
 * The logo that has to degrade to an initial.
 *
 * This component exists because the same `<img onError={hide}>` was copied into
 * seven places and the fallback never actually ran: a URL that 404s — the
 * *common* case, since these point at a third-party logo service — hid the
 * image and left a hole, and rows with and without a logo indented differently
 * so table columns visibly failed to line up.
 *
 * So the load-bearing property is not "renders an image". It is: **the slot is
 * never empty**. Every case below is one route to an empty slot.
 */

describe('CompanyLogo', () => {
  it('renders the image when a URL is given', () => {
    const { container } = render(<CompanyLogo src="https://logo.example/dell.png" name="DELL" />);

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://logo.example/dell.png');
    // Decorative: the company name is always in the row beside it, so an alt
    // would make every screen reader announce the name twice.
    expect(img).toHaveAttribute('alt', '');
  });

  it('falls back to the initial when the image fails to load — REGRESSION', () => {
    // The original bug, in seven copies. A 404 from the logo service used to
    // leave a blank gap where the logo was; it must leave the initial instead.
    const { container } = render(<CompanyLogo src="https://logo.example/404.png" name="DELL" />);

    fireEvent.error(container.querySelector('img')!);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('D')).toBeInTheDocument();
  });

  it('keeps the placeholder classes on the fallback so the slot keeps its size', () => {
    // The second half of the original bug: where the placeholder was omitted,
    // a row with a logo and a row without were indented differently. The
    // fallback must carry the base class *and* the placeholder modifier, or the
    // column stops lining up.
    const { container } = render(<CompanyLogo src="https://logo.example/404.png" name="DELL" />);

    fireEvent.error(container.querySelector('img')!);

    const placeholder = container.querySelector('.customer-logo--placeholder');
    expect(placeholder).not.toBeNull();
    expect(placeholder).toHaveClass('customer-logo');
  });

  it('renders the initial when there is no URL at all', () => {
    render(<CompanyLogo src={null} name="acme corp" />);

    // Upper-cased: the source data is whatever Gmail supplied, so a lowercase
    // display name must not produce a lowercase badge.
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('falls back to ? rather than an empty badge when the name is blank', () => {
    // Contacts synced from a bare address have no display name. An empty span
    // collapses to zero width and the column misaligns again.
    const { container } = render(<CompanyLogo src={undefined} name="   " />);

    expect(container.querySelector('.customer-logo--placeholder')).toHaveTextContent('?');
  });

  it('ignores leading whitespace when picking the initial', () => {
    render(<CompanyLogo name=" dell" />);

    expect(screen.getByText('D')).toBeInTheDocument();
  });

  it('hides the decorative placeholder from assistive tech', () => {
    const { container } = render(<CompanyLogo name="DELL" />);

    expect(container.querySelector('.customer-logo--placeholder')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });

  it('applies the caller class and size modifier to both the image and the fallback', () => {
    // Callers pass their own base class (`contact-logo`, `deal-logo`, …) and the
    // placeholder modifier is derived from it. Hardcoding `customer-logo`
    // anywhere in the component leaves the other six call sites unstyled.
    const { container } = render(
      <CompanyLogo src="https://logo.example/x.png" name="X" className="deal-logo" size="lg" />
    );

    const img = container.querySelector('img')!;
    expect(img).toHaveClass('deal-logo', 'deal-logo--lg');

    fireEvent.error(img);

    const placeholder = container.querySelector('span')!;
    expect(placeholder).toHaveClass('deal-logo', 'deal-logo--lg', 'deal-logo--placeholder');
  });
});
