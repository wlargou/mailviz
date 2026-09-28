import { describe, it, expect } from 'vitest';
import { buildTimeline, todaySummary } from './today';
import type { Today } from '../types/today';
import type { Task } from '../types/task';

const NOW = new Date(2026, 8, 28, 10, 0);
const at = (h: number, m = 0) => new Date(2026, 8, 28, h, m).toISOString();

function task(id: string, due: string | null, extra: Partial<Task> = {}): Task {
  return { id, title: id, dueDate: due, priority: 'MEDIUM', customer: null, ...extra } as Task;
}

function day(over: Partial<Today> = {}): Today {
  return {
    timezone: 'UTC', today: at(0),
    events: [], tasks: { overdue: [], dueToday: [], startingToday: [] }, deadlines: [],
    repliesOwed: [], pursuits: [], waitingOnOthers: [], quietAccounts: [], nextUp: null,
    wrapUp: { finished: [], slipped: [], tomorrow: [] },
    ...over,
  };
}

describe('buildTimeline', () => {
  it('puts meetings, deadlines and timed tasks in time order, and fades what is over', () => {
    const t = buildTimeline(day({
      events: [
        { id: 'e2', title: 'Comité', startTime: at(14), endTime: at(15), isAllDay: false, location: null, conferenceLink: null, companies: [{ id: 'c', name: 'BKAM' }], attendeeCount: 3 },
        { id: 'e1', title: 'Standup', startTime: at(9), endTime: at(9, 30), isAllDay: false, location: null, conferenceLink: null, companies: [], attendeeCount: 2 },
        { id: 'e0', title: 'Holiday', startTime: at(0), endTime: at(23, 59), isAllDay: true, location: null, conferenceLink: null, companies: [], attendeeCount: 0 },
      ],
      deadlines: [{ kind: 'PIECE_DUE', id: 'p1', title: 'Caution', context: 'AIX', at: at(18), href: '/rfps/r1' }],
      tasks: { overdue: [], dueToday: [task('call', at(11, 30))], startingToday: [] },
    }), NOW);

    expect(t.timed.map((i) => i.id)).toEqual(['e1', 'call', 'e2', 'PIECE_DUE:p1']);
    expect(t.timed.map((i) => i.past)).toEqual([true, false, false, false]);
    expect(t.timed[2]).toMatchObject({ kind: 'meeting', context: 'BKAM' });
    expect(t.timed[3]).toMatchObject({ kind: 'deadline', label: 'Piece due', href: '/rfps/r1' });
  });

  it('gathers late tasks and tasks due with no hour before the timed ones', () => {
    const t = buildTimeline(day({
      tasks: {
        overdue: [task('late', new Date(2026, 8, 26).toISOString())],
        dueToday: [task('anytime', at(0)), task('at-noon', at(12))],
        startingToday: [],
      },
    }), NOW);

    expect(t.anytime.map((i) => [i.id, i.kind === 'task' && i.late])).toEqual([['late', true], ['anytime', false]]);
    expect(t.timed.map((i) => i.id)).toEqual(['at-noon']);
  });

  it('adds work that can start today, once, after what is due', () => {
    const due = task('due-and-starting', at(0));
    const t = buildTimeline(day({
      tasks: { overdue: [], dueToday: [due], startingToday: [due, task('starts', null)] },
    }), NOW);
    expect(t.anytime.map((i) => [i.id, i.kind === 'task' && Boolean(i.starts)])).toEqual([['due-and-starting', false], ['starts', true]]);
  });

  it('marks a timed task whose hour has passed as late', () => {
    const t = buildTimeline(day({ tasks: { overdue: [], dueToday: [task('at-nine', at(9))], startingToday: [] } }), NOW);
    expect(t.timed[0]).toMatchObject({ kind: 'task', late: true });
  });
});

describe('todaySummary', () => {
  it('names the parts that are not zero, and counts the work that is due', () => {
    const s = todaySummary(day({
      pursuits: [
        { kind: 'RFP', id: 'r', title: 'AIX', reference: null, company: null, customerId: null, at: at(18), readiness: { ready: 0, total: 3 }, atRisk: true, href: '' },
        { kind: 'DEAL', id: 'd', title: 'Renewal', reference: null, company: null, customerId: null, at: at(18), readiness: null, atRisk: false, href: '' },
      ],
      tasks: { overdue: [task('a', null), task('b', null)], dueToday: [], startingToday: [] },
      events: [
        { id: 'past', title: 'Over', startTime: at(8), endTime: at(9), isAllDay: false, location: null, conferenceLink: null, companies: [], attendeeCount: 0 },
        { id: 'next', title: 'Next', startTime: at(11), endTime: at(12), isAllDay: false, location: null, conferenceLink: null, companies: [], attendeeCount: 0 },
      ],
      repliesOwed: [{ threadId: 't', emailId: 'e', subject: 's', from: 'f', fromName: null, receivedAt: at(8) }],
    }), NOW);

    expect(s.parts).toEqual(['1 tender at risk', '2 tasks late', '1 meeting', '1 reply owed']);
    // The tender and the two late tasks; meetings and replies are named, not counted.
    expect(s.count).toBe(3);
  });

  it('says nothing when nothing is pressing', () => {
    expect(todaySummary(day(), NOW)).toEqual({ count: 0, parts: [] });
  });
});
