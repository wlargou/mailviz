import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { NotFoundPage } from './NotFoundPage';

/**
 * The catch-all.
 *
 * Its whole reason for existing is that an unmatched path used to render
 * nothing — a blank page with no navigation, which is what a single wrong link
 * produced. So the things worth asserting are that it renders at all for an
 * arbitrary path, and that it offers a way out.
 */

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>dashboard</div>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('NotFoundPage', () => {
  it('renders for a path with no route rather than showing nothing', () => {
    renderAt('/companies/some-id');

    expect(screen.getByText(/Page not found/i)).toBeInTheDocument();
  });

  it('names the path that was asked for', () => {
    // Turns "the app broke" into "that link is wrong".
    renderAt('/companies/abc-123');

    expect(screen.getByText(/\/companies\/abc-123/)).toBeInTheDocument();
  });

  it('offers a way back that does not need browser chrome', async () => {
    renderAt('/nope');

    await userEvent.click(screen.getByRole('button', { name: /Go to dashboard/i }));

    expect(screen.getByText('dashboard')).toBeInTheDocument();
  });
});
