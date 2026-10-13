import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AccountOverview, AccountTimeline, warmthOf } from './AccountOverview';
import { accountsApi } from '../../api/customers';
import { tasksApi } from '../../api/tasks';

vi.mock('../../api/customers', () => ({ accountsApi: { overview: vi.fn(), timeline: vi.fn() } }));
vi.mock('../../api/tasks', () => ({ tasksApi: { getById: vi.fn() } }));
vi.mock('../../api/labels', () => ({ labelsApi: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) } }));
// The panels themselves are tested where they live; here, what they are opened with.
vi.mock('../tasks/TaskCreateModal', () => ({
  TaskCreateModal: (p: { open: boolean; initialCustomerId: string | null; initial: { title: string; form: { priority: string; customerId: string | null; description: string; dueDate: string | null } } | null }) =>
    p.open ? <div data-testid="task-panel">{JSON.stringify({ customer: p.initialCustomerId, initial: p.initial && { title: p.initial.title, priority: p.initial.form.priority, customerId: p.initial.form.customerId, description: p.initial.form.description, dueDate: p.initial.form.dueDate } })}</div> : null,
}));
vi.mock('../deals/DealCreateModal', () => ({
  DealCreateModal: (p: { open: boolean; initialCustomerId: string | null }) =>
    p.open ? <div data-testid="deal-panel">{p.initialCustomerId}</div> : null,
}));

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
            deals: [{ id: 'd1', title: 'Registration MLOps', status: 'APPROVED', expiryDate: new Date(2026, 9, 28, 10).toISOString(), partner: { name: 'Red Hat' } }],
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

    const tasks = screen.getByRole('heading', { name: 'Tasks' }).closest('section')!;
    expect(within(tasks).getByText('+ 2 more tasks')).toBeInTheDocument();
    expect(within(tasks).queryByText('tender · in 2 days')).toBeNull();
    await user.click(within(tasks).getByRole('button', { name: 'Provisionnement OpenShift AI' }));
    expect(onOpenTask).toHaveBeenCalledWith('t1');

    const deals = screen.getByRole('heading', { name: 'Deals' }).closest('section')!;
    expect(within(deals).getByText('tender · in 2 days')).toBeInTheDocument();
    expect(within(deals).getByRole('button', { name: 'Registration MLOps' })).toBeInTheDocument();
    expect(within(deals).getByText('Red Hat · expires in 30 days')).toBeInTheDocument();

    const people = screen.getByRole('heading', { name: 'People who matter' }).closest('section')!;
    expect(within(people).getAllByRole('button').map((b) => b.textContent)).toEqual(['Head of infrastructure', 'Project manager']);
    expect(within(people).getByText('142')).toBeInTheDocument();
  });

  it('says so when nothing is open', async () => {
    vi.mocked(accountsApi.overview).mockResolvedValueOnce({
      data: { data: { lastTouchAt: null, weekly: [], open: { tasks: [], taskCount: 0, tenders: [], deals: [] }, keyPeople: [] } },
    } as never);
    render(<MemoryRouter><AccountOverview customerId="c1" onOpenTask={vi.fn()} now={NOW} /></MemoryRouter>);
    expect(await screen.findByText('No open task with them.')).toBeInTheDocument();
    expect(screen.getByText('No open tender or deal registration.')).toBeInTheDocument();
    expect(screen.getByText('No exchange yet')).toBeInTheDocument();
  });
});

describe('AccountOverview — starting work from it', () => {
  const overview = () => render(<MemoryRouter><AccountOverview customerId="c1" onOpenTask={vi.fn()} now={NOW} /></MemoryRouter>);

  beforeEach(() => {
    vi.mocked(accountsApi.overview).mockResolvedValue({
      data: { data: { lastTouchAt: null, weekly: [], keyPeople: [], open: {
        tasks: [{ id: 't1', title: 'Provisionnement &amp; MLOps', dueDate: null, priority: 'HIGH', status: 'TODO' }],
        taskCount: 1, tenders: [], deals: [],
      } } },
    } as never);
  });

  it('duplicates a task into the task panel: what the work is, not when it is due', async () => {
    const user = userEvent.setup();
    vi.mocked(tasksApi.getById).mockResolvedValue({ data: { data: {
      id: 't1', title: 'Provisionnement &amp; MLOps', description: 'Cluster + GPU', priority: 'HIGH', customerId: 'c1',
      labels: [{ id: 'l1' }], estimatedMinutes: 60, dueDate: '2026-10-01T00:00:00.000Z',
    } } } as never);
    overview();

    await user.click(await screen.findByRole('button', { name: 'Duplicate' }));
    expect(tasksApi.getById).toHaveBeenCalledWith('t1');
    expect(JSON.parse((await screen.findByTestId('task-panel')).textContent!)).toEqual({
      customer: null,
      initial: { title: 'Provisionnement & MLOps', priority: 'HIGH', customerId: 'c1', description: 'Cluster + GPU', dueDate: null },
    });
  });

  it('opens a new task and a new deal already filed under the company', async () => {
    const user = userEvent.setup();
    overview();

    await user.click(await screen.findByRole('button', { name: 'New task' }));
    expect(JSON.parse(screen.getByTestId('task-panel').textContent!)).toEqual({ customer: 'c1', initial: null });

    await user.click(screen.getByRole('button', { name: 'New deal' }));
    expect(screen.getByTestId('deal-panel').textContent).toBe('c1');
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
