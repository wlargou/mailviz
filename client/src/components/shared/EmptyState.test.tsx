import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

/**
 * The one empty state, used by ten pages and every dashboard card.
 *
 * Two props carry the whole contract and both are easy to break by "tidying up"
 * the one-line `showIcon` expression:
 *
 *  - `icon={null}` must suppress the icon. A caller passing null gets a
 *    decorative circle it explicitly asked not to have.
 *  - `size` picks the density. `sm` exists because the bordered md treatment is
 *    taller than the dashboard card holding it, so a regression there does not
 *    look like a wrong icon — it blows out five cards' layout.
 *
 * `sm` also drops the *default* icon while still honouring an explicit one, and
 * that pair of behaviours is exactly what a simplified boolean loses.
 */

describe('EmptyState', () => {
  it('renders the title as a heading, with the description beside it', () => {
    render(<EmptyState title="No contacts yet" description="Sync your calendar" />);

    expect(screen.getByRole('heading', { name: 'No contacts yet' })).toBeInTheDocument();
    expect(screen.getByText('Sync your calendar')).toBeInTheDocument();
  });

  it('omits the description entirely when none is given', () => {
    const { container } = render(<EmptyState title="No contacts yet" />);

    expect(container.querySelector('p')).toBeNull();
  });

  it('shows the default icon at md', () => {
    // md is the full treatment for an empty page: something has to occupy the
    // slot above the title or the block reads as a rendering failure.
    const { container } = render(<EmptyState title="Nothing here" />);

    expect(container.querySelector('.empty-state__icon')).not.toBeNull();
  });

  it('suppresses the icon when icon={null}', () => {
    // The documented opt-out. If this fails, every caller that deliberately
    // passed null gets an icon back.
    const { container } = render(<EmptyState title="Nothing here" icon={null} />);

    expect(container.querySelector('.empty-state__icon')).toBeNull();
  });

  it('drops the default icon at sm, where the text is the whole message', () => {
    const { container } = render(<EmptyState title="Nothing here" size="sm" />);

    expect(container.querySelector('.empty-state__icon')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
  });

  it('still shows an explicitly supplied icon at sm', () => {
    // sm skips the *default* icon only. A card that asks for a specific icon —
    // a warning, say — must keep it, otherwise the distinction between
    // "nothing yet" and "something went wrong" disappears from the card.
    render(<EmptyState title="Nothing here" size="sm" icon={<svg data-testid="custom-icon" />} />);

    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('marks the dense variant so the card stylesheet can pick it up', () => {
    // Density is only ever expressed as this class — the SCSS keys off it — so
    // it is the only observable proof the size prop reached the DOM.
    const { container } = render(<EmptyState title="Nothing here" size="sm" />);
    expect(container.querySelector('.empty-state--sm')).not.toBeNull();

    const { container: mdContainer } = render(<EmptyState title="Nothing here" />);
    expect(mdContainer.querySelector('.empty-state--sm')).toBeNull();
  });

  it('renders the action node when one is given, and no wrapper when not', () => {
    const { container } = render(
      <EmptyState title="No contacts yet" action={<button type="button">Add contact</button>} />
    );

    expect(screen.getByRole('button', { name: 'Add contact' })).toBeInTheDocument();

    const { container: bare } = render(<EmptyState title="No contacts yet" />);
    expect(container.querySelector('.empty-state__action')).not.toBeNull();
    expect(bare.querySelector('.empty-state__action')).toBeNull();
  });
});
