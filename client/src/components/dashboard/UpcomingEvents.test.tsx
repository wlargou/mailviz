import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UpcomingEvents } from './UpcomingEvents';
import type { DashboardStats } from '../../types/dashboard';

function at(daysFromToday: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function event(id: string, title: string, start: string) {
  return { id, title, startTime: start, endTime: start, isAllDay: false, location: null, conferenceLink: null };
}

function renderWith(events: ReturnType<typeof event>[]) {
  const stats = { calendar: { upcomingEvents: events, eventsToday: 0 } } as unknown as DashboardStats;
  render(
    <MemoryRouter>
      <UpcomingEvents stats={stats} loading={false} />
    </MemoryRouter>,
  );
}

describe('UpcomingEvents', () => {
  it('puts each day under its own heading, once', () => {
    renderWith([
      event('a', 'Suivi interne', at(0, 20)),
      event('b', 'Audit de configuration', at(0, 21)),
      event('c', 'Weekly TMPA', at(1, 11)),
      event('d', 'Clôture SRM', at(3, 11)),
    ]);

    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings[0]).toBe('Today');
    expect(headings[1]).toBe('Tomorrow');
    expect(headings[2]).toMatch(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]{2}$/);
    expect(headings).toHaveLength(3);

    // Tomorrow's heading sits between today's last event and tomorrow's first.
    const order = [...document.querySelectorAll('.upcoming-events__day, .upcoming-event__title')].map((e) => e.textContent);
    expect(order.indexOf('Tomorrow')).toBe(order.indexOf('Audit de configuration') + 1);
  });
});
