import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TodayPage } from './TodayPage';
import { todayApi } from '../../api/today';
import { tasksApi } from '../../api/tasks';
import type { Today } from '../../types/today';
import type { Task } from '../../types/task';

/**
 * Today, the home page. The server decides what belongs; the page decides the
 * order and offers the two actions that close a day out — finish a task, move
 * a slipped one to tomorrow. Pinned: the headline counts, the next meeting
 * with its prep, late work first, and the wrap-up leading after 17:00.
 */

vi.mock('../../api/today', () => ({ todayApi: { get: vi.fn() } }));
vi.mock('../../api/tasks', () => ({ tasksApi: { update: vi.fn(), getById: vi.fn(), getActivity: vi.fn() } }));
vi.mock('../../api/taskStatuses', () => ({
  taskStatusesApi: {
    getAll: vi.fn().mockResolvedValue({
      data: { data: [
        { id: 's1', name: 'OPEN', label: 'Open', color: '', position: 0, isTerminal: false, createdAt: '' },
        { id: 's2', name: 'SHIPPED', label: 'Shipped', color: '', position: 1, isTerminal: true, createdAt: '' },
      ] },
    }),
  },
}));
vi.mock('../../api/labels', () => ({ labelsApi: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) } }));
vi.mock('../../api/calendar', () => ({ calendarApi: { getById: vi.fn(), delete: vi.fn(), respond: vi.fn() } }));
vi.mock('../../hooks/useEmailWebSocket', () => ({ useEmailWebSocket: () => {} }));
// The dialogs are their own components with their own tests.
vi.mock('../tasks/TaskDetailModal', () => ({ TaskDetailModal: () => null }));
vi.mock('../tasks/TaskCreateModal', () => ({ TaskCreateModal: () => null }));
vi.mock('../calendar/EventModal', () => ({ EventModal: () => null }));
vi.mock('../calendar/EventDetailModal', () => ({ EventDetailModal: () => null }));
vi.mock('../deals/DealCreateModal', () => ({ DealCreateModal: () => null }));
vi.mock('../mail/MailComposeModal', () => ({ MailComposeModal: () => null }));
vi.mock('../mail/ThreadDetail', () => ({ ThreadDetail: () => null }));

const MORNING = new Date(2026, 8, 28, 9, 35);
const EVENING = new Date(2026, 8, 28, 18, 5);
const at = (h: number, m = 0) => new Date(2026, 8, 28, h, m).toISOString();

function task(id: string, title: string, dueDate: string | null): Task {
  return { id, title, dueDate, priority: 'HIGH', customer: { id: 'c1', name: 'Atlascs' } } as Task;
}

function fixture(): Today {
  return {
    timezone: 'UTC',
    today: at(0),
    events: [
      { id: 'e1', title: 'Réunion de suivi', startTime: at(10), endTime: at(10, 30), isAllDay: false, location: 'Teams', conferenceLink: 'https://meet.example/x', companies: [{ id: 'c2', name: 'Attijariwafa' }], attendeeCount: 6 },
    ],
    tasks: {
      overdue: [task('t-late', 'Sync ADFS', new Date(2026, 8, 26).toISOString())],
      dueToday: [task('t-today', 'Send the planning', at(0))],
      startingToday: [],
    },
    deadlines: [{ kind: 'PIECE_DUE', id: 'p1', title: 'Caution bancaire', context: 'Refonte AIX', at: at(18), href: '/rfps/r1' }],
    repliesOwed: [{ threadId: 'th1', emailId: 'm1', subject: 'Provisionnement OpenShift', from: 'omar@bkam.ma', fromName: 'Omar', receivedAt: new Date(2026, 8, 27, 8).toISOString() }],
    pursuits: [{ kind: 'RFP', id: 'r1', title: 'Refonte AIX', reference: '70/AOO/BKAM/2026', company: 'BKAM', customerId: 'c3', at: new Date(2026, 8, 30, 11).toISOString(), readiness: { ready: 0, total: 10 }, atRisk: true, href: '/rfps/r1' }],
    waitingOnOthers: [{ threadId: 'th2', subject: 'Deal reg. extension', to: 'Red Hat <partner@redhat.com>', sentAt: new Date(2026, 8, 22).toISOString() }],
    quietAccounts: [{ id: 'c4', name: 'Sahambank', lastTouchAt: new Date(2026, 8, 4).toISOString(), openWork: 1 }],
    nextUp: {
      event: { id: 'e1', title: 'Réunion de suivi', startTime: at(10), endTime: at(10, 30), isAllDay: false, location: 'Teams', conferenceLink: 'https://meet.example/x', companies: [{ id: 'c2', name: 'Attijariwafa' }], attendeeCount: 6 },
      prep: {
        people: [{ email: 'a@awb.ma', name: 'Amine', responseStatus: 'accepted' }],
        recentThreads: [{ threadId: 'th3', subject: 'Namespaces OpenShift AI', from: 'Amine', receivedAt: new Date(2026, 8, 27).toISOString() }],
        openTasks: [{ id: 't9', title: 'Privilèges MESAOUDI', dueDate: null, priority: 'MEDIUM' }],
        tenders: [],
      },
    },
    wrapUp: {
      finished: [{ id: 't0', title: 'Invoice sent' }],
      slipped: [{ id: 't-today', title: 'Send the planning' }],
      tomorrow: [{ kind: 'EVENT', id: 'e9', title: 'Comité BKAM', at: new Date(2026, 8, 29, 9).toISOString() }],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(todayApi.get).mockResolvedValue({ data: { data: fixture() } } as never);
  vi.mocked(tasksApi.update).mockResolvedValue({ data: { data: {} } } as never);
});

function renderAt(now: Date) {
  render(
    <MemoryRouter>
      <TodayPage now={now} />
    </MemoryRouter>,
  );
}

describe('TodayPage', () => {
  it('counts what needs you in the headline, and names the parts', async () => {
    renderAt(MORNING);
    expect(await screen.findByRole('heading', { level: 1, name: /Good morning — 3 things need you/ })).toBeInTheDocument();
    expect(screen.getByText(/1 tender at risk · 1 task late · 1 task due · 1 meeting · 1 reply owed/)).toBeInTheDocument();
  });

  it('leads with the next meeting, a way in, and what to know walking in', async () => {
    renderAt(MORNING);
    const next = (await screen.findByText(/^Next · in 25 minutes$/)).closest('section')!;
    expect(within(next).getByRole('button', { name: 'Réunion de suivi' })).toBeInTheDocument();
    expect(within(next).getByRole('link', { name: /Join/ })).toHaveAttribute('href', 'https://meet.example/x');
    expect(within(next).getByRole('button', { name: 'Namespaces OpenShift AI' })).toBeInTheDocument();
    expect(within(next).getByRole('button', { name: 'Privilèges MESAOUDI' })).toBeInTheDocument();
  });

  it('puts late work first in the day, then the rest in time order', async () => {
    renderAt(MORNING);
    const day = (await screen.findByRole('heading', { name: 'Your day' })).closest('section')!;
    const rows = within(day).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(rows[0]).toMatch(/^Late.*Sync ADFS/);
    expect(rows[1]).toMatch(/^Today.*Send the planning/);
    // Now (09:35) sits between the late work and the 10:00 meeting.
    expect(rows.findIndex((r) => r.includes('Réunion de suivi'))).toBeLessThan(rows.findIndex((r) => r.includes('Caution bancaire')));
  });

  it('finishes a task with the account’s terminal status', async () => {
    const user = userEvent.setup();
    renderAt(MORNING);
    const box = await screen.findByRole('checkbox', { name: 'Mark done: Sync ADFS' });
    await waitFor(() => expect(box).toBeEnabled());
    await user.click(box);
    expect(tasksApi.update).toHaveBeenCalledWith('t-late', { status: 'SHIPPED' });
  });

  it('shows the pursuits closing, at risk, and who is waiting either way', async () => {
    renderAt(MORNING);
    const pursuits = (await screen.findByRole('heading', { name: 'Pursuits closing' })).closest('section')!;
    expect(within(pursuits).getByText('▲ in 2 days')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Provisionnement OpenShift' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deal reg. extension' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sahambank' })).toBeInTheDocument();
  });

  it('opens the day with the wrap-up after 17:00, and moves slipped work to tomorrow', async () => {
    const user = userEvent.setup();
    renderAt(EVENING);
    const wrap = (await screen.findByRole('heading', { name: 'Wrap-up' })).closest('section')!;
    // First in the main column.
    expect(wrap.parentElement?.firstElementChild).toBe(wrap);
    expect(within(wrap).getByText('Invoice sent')).toBeInTheDocument();
    expect(within(wrap).getByText('Comité BKAM')).toBeInTheDocument();

    await user.click(within(wrap).getByRole('button', { name: 'Move to tomorrow' }));
    const [id, body] = vi.mocked(tasksApi.update).mock.calls[0] as [string, { dueDate: string }];
    expect(id).toBe('t-today');
    // No hour on the original: tomorrow at 09:00.
    expect(new Date(body.dueDate)).toEqual(new Date(2026, 8, 29, 9, 0));
  });

  it('keeps the wrap-up below the day in the morning', async () => {
    renderAt(MORNING);
    const wrap = (await screen.findByRole('heading', { name: 'Wrap-up' })).closest('section')!;
    expect(wrap.parentElement?.firstElementChild).not.toBe(wrap);
  });
});
