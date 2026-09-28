import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RfpCorrespondence } from './RfpCorrespondence';
import { rfpsApi } from '../../api/rfps';

vi.mock('../../api/rfps', () => ({ rfpsApi: { getThreads: vi.fn(), unlinkThread: vi.fn() } }));
vi.mock('../mail/ThreadDetail', () => ({ ThreadDetail: ({ threadId }: { threadId: string }) => <div>reading {threadId}</div> }));
vi.mock('../../store/uiStore', () => ({ useUIStore: (sel: (s: { addNotification: () => void }) => unknown) => sel({ addNotification: vi.fn() }) }));

const THREADS = {
  threads: [{ threadId: 'th1', subject: 'RE: Clarification n°2', from: 'Buyer', receivedAt: new Date().toISOString(), messages: 3, linkedBy: 'Sara' }],
  hidden: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rfpsApi.getThreads).mockResolvedValue({ data: { data: THREADS } } as never);
  vi.mocked(rfpsApi.unlinkThread).mockResolvedValue({ data: { data: { threads: [], hidden: 2 } } } as never);
});

describe('RfpCorrespondence', () => {
  it('lists filed threads with who filed them, and counts the ones you cannot read', async () => {
    render(<RfpCorrespondence rfpId="r1" />);
    expect(await screen.findByRole('button', { name: 'RE: Clarification n°2' })).toBeInTheDocument();
    expect(screen.getByText('Buyer · 3 messages · filed by Sara')).toBeInTheDocument();
    expect(screen.getByText('2 more filed by others, in mailboxes you cannot read.')).toBeInTheDocument();
  });

  it('reads a thread beside the tender, and unfiles one', async () => {
    const user = userEvent.setup();
    render(<RfpCorrespondence rfpId="r1" />);
    await user.click(await screen.findByRole('button', { name: 'RE: Clarification n°2' }));
    expect(screen.getByText('reading th1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for RE: Clarification n°2' }));
    const items = await screen.findAllByRole('menuitem', { hidden: true });
    await user.click(items.find((i) => i.textContent?.includes('Unfile'))!);
    expect(rfpsApi.unlinkThread).toHaveBeenCalledWith('r1', 'th1');
    expect(await screen.findByText('No mail filed yet.')).toBeInTheDocument();
  });
});
