import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AccountOverview, AccountTimeline, warmthOf } from './AccountOverview';
import { accountsApi } from '../../api/customers';

vi.mock('../../api/customers', () => ({ accountsApi: { overview: vi.fn(), timeline: vi.fn() } }));

const NOW = new Date(2026, 8, 28, 10);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('warmthOf', () => {
  it('reads the relationship off the last exchange', () => {
    expect(warmthOf(null, NOW)).toBe('No exchange yet');
    expect(warmthOf(daysAgo(14), NOW)).toBe('Active');
    expect(warmthOf(daysAgo(15), NOW)).toBe('Cooling');
    expect(warmthOf(daysAgo(35), NOW)).toBe('Cooling');
    expect(warmthOf(daysAgo(36), NOW)).toBe('Quiet');
  });
});

describe('AccountOverview', () => {
  beforeEach(() => {
    vi.mocked(accountsApi.overview).mockResolvedValue({
      data: {
        data: {
          lastTouchAt: daysAgo(1),
          weekly: Array.from({ length: 12 }, (_, i) => ({ weekStart: daysAgo(77 - i * 7), emails: i === 11 ? 4 : 0, meetings: i === 11 ? 1 : 0 })),
          open: {
            tasks: [{ id: 't1', title: 'Provisionnement OpenShift AI', dueDate: daysAgo(1), priority: 'HIGH', status: 'TODO' }],
            taskCount: 3,
            tenders: [{ id: 'r1', name: 'Refonte AIX', reference: '70/AOO', status: 'WORKING', deadlineAt: new Date(2026, 8, 30, 11).toISOString() }],
            deals: [],
          },
          keyPeople: [
            { id: 'p1', name: 'Head of infrastructure', email: 'a@awb.ma', role: 'CTO', exchanges: 142, lastAt: daysAgo(1) },
            { id: 'p2', name: 'Project manager', email: 'b@awb.ma', role: null, exchanges: 97, lastAt: daysAgo(3) },
          ],
        },
      },
    } as never);
  });

  it('says how the relationship is going, what is open, and who matters', async () => {
    const onOpenTask = vi.fn();
    const user = userEvent.setup();
    render(<MemoryRouter><AccountOverview customerId="c1" onOpenTask={onOpenTask} now={NOW} /></MemoryRouter>);

    const relationship = (await screen.findByRole('heading', { name: 'Relationship' })).closest('section')!;
    expect(within(relationship).getByText('Active')).toBeInTheDocument();
    expect(within(relationship).getByText('last exchange yesterday')).toBeInTheDocument();
    expect(within(relationship).getByRole('img', { name: /last 12 weeks/ }).children).toHaveLength(12);

    const open = screen.getByRole('heading', { name: 'Open with them' }).closest('section')!;
    expect(within(open).getByText('tender · in 2 days')).toBeInTheDocument();
    expect(within(open).getByText('+ 2 more tasks')).toBeInTheDocument();
    await user.click(within(open).getByRole('button', { name: 'Provisionnement OpenShift AI' }));
    expect(onOpenTask).toHaveBeenCalledWith('t1');

    const people = screen.getByRole('heading', { name: 'People who matter' }).closest('section')!;
    expect(within(people).getAllByRole('button').map((b) => b.textContent)).toEqual(['Head of infrastructure', 'Project manager']);
    expect(within(people).getByText('142')).toBeInTheDocument();
  });

  it('says so when nothing is open', async () => {
    vi.mocked(accountsApi.overview).mockResolvedValueOnce({
      data: { data: { lastTouchAt: null, weekly: [], open: { tasks: [], taskCount: 0, tenders: [], deals: [] }, keyPeople: [] } },
    } as never);
    render(<MemoryRouter><AccountOverview customerId="c1" onOpenTask={vi.fn()} now={NOW} /></MemoryRouter>);
    expect(await screen.findByText('Nothing open — no task, tender or deal.')).toBeInTheDocument();
    expect(screen.getByText('No exchange yet')).toBeInTheDocument();
  });
});

describe('AccountTimeline', () => {
  it('opens a thread in place, and pages back from where it stopped', async () => {
    const user = userEvent.setup();
    const onOpenThread = vi.fn();
    vi.mocked(accountsApi.timeline)
      .mockResolvedValueOnce({ data: { data: { entries: [
        { kind: 'THREAD', id: 'e1', threadId: 'th1', title: 'Re: Offer', detail: 'Omar', at: daysAgo(1) },
        { kind: 'MEETING', id: 'm1', title: 'Kickoff', detail: null, at: daysAgo(2) },
      ], nextBefore: daysAgo(2) } } } as never)
      .mockResolvedValueOnce({ data: { data: { entries: [
        { kind: 'TENDER', id: 'r1', title: 'Refonte AIX', detail: 'WORKING', at: daysAgo(9) },
      ], nextBefore: null } } } as never);

    render(<MemoryRouter><AccountTimeline customerId="c1" onOpenThread={onOpenThread} onOpenTask={vi.fn()} /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'Re: Offer' }));
    expect(onOpenThread).toHaveBeenCalledWith('th1', 'Re: Offer');

    await user.click(screen.getByRole('button', { name: 'Show older' }));
    expect(accountsApi.timeline).toHaveBeenLastCalledWith('c1', daysAgo(2));
    expect(await screen.findByRole('button', { name: 'Refonte AIX' })).toBeInTheDocument();
    // Kept the first page, and nothing more to load.
    expect(screen.getByRole('button', { name: 'Kickoff' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show older' })).not.toBeInTheDocument();
  });
});
