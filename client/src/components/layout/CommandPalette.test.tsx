import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { CommandPalette } from './CommandPalette';
import { searchApi } from '../../api/search';

vi.mock('../../api/search', () => ({ searchApi: { search: vi.fn() } }));

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function renderPalette() {
  render(
    <MemoryRouter initialEntries={['/mail']}>
      <CommandPalette />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchApi.search).mockResolvedValue({
    data: { data: { emails: [], tasks: [], events: [], contacts: [], deals: [], rfps: [], customers: [{ id: 'c1', name: 'BKAM', company: null, email: null, logoUrl: null }] } },
  } as never);
});

describe('CommandPalette', () => {
  it('opens on ⌘K and Ctrl+K, and closes on Escape', async () => {
    const user = userEvent.setup();
    renderPalette();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Meta>}k{/Meta}');
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('runs the highlighted item on Enter, after moving with the arrows', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    await user.type(screen.getByRole('combobox'), 'bkam');
    await screen.findByRole('option', { name: /New task for BKAM/ });
    // Best match first; one down is the task for it.
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByTestId('where')).toHaveTextContent('/tasks?new=1&customer=c1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('searches once for a burst of typing', async () => {
    const user = userEvent.setup({ delay: null });
    renderPalette();
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox'), 'bkam');
    await screen.findByRole('option', { name: /New task for BKAM/ });
    expect(searchApi.search).toHaveBeenCalledTimes(1);
    expect(searchApi.search).toHaveBeenCalledWith('bkam');
  });
});
