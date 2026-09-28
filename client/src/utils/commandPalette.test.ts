import { describe, it, expect } from 'vitest';
import { paletteItems, ACTIONS, PAGES } from './commandPalette';
import type { SearchResults } from '../api/search';

const NOW = new Date('2026-09-28T09:00:00Z');

function results(over: Partial<SearchResults> = {}): SearchResults {
  return { emails: [], tasks: [], events: [], customers: [], contacts: [], deals: [], rfps: [], ...over };
}

const BKAM = results({
  emails: [{ id: 'm1', threadId: 'th/1', subject: 'RE: AO 70/AOO/BKAM', from: 'x@bkam.ma', fromName: 'Omar', snippet: null, receivedAt: '2026-09-26' }],
  events: [{ id: 'e1', title: 'Comité BKAM 2025', startTime: '2025-03-01', endTime: '2025-03-01', location: null }],
  customers: [{ id: 'c1', name: 'BKAM', company: null, email: null, logoUrl: null }],
  rfps: [{ id: 'r1', name: 'Refonte AIX', reference: '70/AOO/BKAM/2026', status: 'WORKING', deadlineAt: '2026-09-30T11:00:00Z', customer: { id: 'c1', name: 'BKAM' } }],
});

describe('paletteItems', () => {
  it('offers the create actions and every page when nothing is typed', () => {
    const items = paletteItems('', null, NOW);
    expect(items.filter((i) => i.group === 'Do')).toHaveLength(ACTIONS.length);
    expect(items.filter((i) => i.group === 'Go to')).toHaveLength(PAGES.length);
  });

  it('puts the live tender first, then what to do with it, then records, and mail last', () => {
    const items = paletteItems('BKAM', BKAM, NOW);
    expect(items.map((i) => [i.group, i.label])).toEqual([
      ['Best match', 'Refonte AIX'],
      ['Do', 'Prepare the pieces of Refonte AIX'],
      ['Go to', 'BKAM'],
      ['Go to', 'Comité BKAM 2025'],
      ['Mail', 'RE: AO 70/AOO/BKAM'],
    ]);
    expect(items[0]).toMatchObject({ href: '/rfps/r1', hint: 'Tender · BKAM · due in 3 days' });
    // A thread opens where it is, across folders.
    expect(items[4].href).toBe('/mail?folder=all&thread=th%2F1');
  });

  it('offers a task for the company when the company is the best match', () => {
    const items = paletteItems('bkam', results({ customers: BKAM.customers }), NOW);
    expect(items[1]).toMatchObject({ group: 'Do', label: 'New task for BKAM', href: '/tasks?new=1&customer=c1' });
  });

  it('lists a recurring meeting once', () => {
    const e = (id: string) => ({ id, title: 'Weekly', startTime: '2026-09-01', endTime: '2026-09-01', location: null });
    const items = paletteItems('weekly', results({ events: [e('a'), e('b'), e('c')] }), NOW);
    expect(items.filter((i) => i.label === 'Weekly')).toHaveLength(1);
  });

  it('matches actions and pages by their words, every word', () => {
    const labels = paletteItems('new task', results(), NOW).map((i) => i.label);
    expect(labels).toEqual(['New task']);
    expect(paletteItems('reply', results(), NOW).map((i) => i.label)).toEqual(['To reply']);
  });
});
