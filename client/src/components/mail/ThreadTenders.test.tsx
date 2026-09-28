import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThreadTenders } from './ThreadTenders';
import { rfpsApi } from '../../api/rfps';

vi.mock('../../api/rfps', () => ({ rfpsApi: { getThreadTenders: vi.fn(), linkThread: vi.fn() } }));
vi.mock('../../store/uiStore', () => ({ useUIStore: (sel: (s: { addNotification: () => void }) => unknown) => sel({ addNotification: vi.fn() }) }));

const AIX = { id: 'r1', name: 'Refonte AIX', reference: '70/AOO/BKAM/2026', status: 'WORKING' };

beforeEach(() => vi.clearAllMocks());

describe('ThreadTenders', () => {
  it('offers to file a thread that quotes a tender, and shows it filed after', async () => {
    const user = userEvent.setup();
    vi.mocked(rfpsApi.getThreadTenders)
      .mockResolvedValueOnce({ data: { data: { linked: [], suggested: [AIX] } } } as never)
      .mockResolvedValueOnce({ data: { data: { linked: [AIX], suggested: [] } } } as never);
    vi.mocked(rfpsApi.linkThread).mockResolvedValue({ data: { data: { threads: [], hidden: 0 } } } as never);

    render(<MemoryRouter><ThreadTenders threadId="th1" /></MemoryRouter>);

    expect(await screen.findByText('70/AOO/BKAM/2026 — Refonte AIX')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'File under it' }));

    expect(rfpsApi.linkThread).toHaveBeenCalledWith('r1', 'th1');
    expect(await screen.findByText('Tender · Refonte AIX')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'File under it' })).not.toBeInTheDocument();
  });

  it('shows nothing for a thread that quotes no tender', async () => {
    vi.mocked(rfpsApi.getThreadTenders).mockResolvedValue({ data: { data: { linked: [], suggested: [] } } } as never);
    const { container } = render(<MemoryRouter><ThreadTenders threadId="th1" /></MemoryRouter>);
    await waitFor(() => expect(rfpsApi.getThreadTenders).toHaveBeenCalled());
    expect(container.querySelector('.cds--actionable-notification')).toBeNull();
  });
});
