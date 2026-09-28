import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToReplyList, waitingFor } from './ToReplyList';
import type { ReplyOwed } from '../../types/email';

const NOW = new Date('2026-09-28T12:00:00Z');

function owed(overrides: Partial<ReplyOwed> = {}): ReplyOwed {
  return {
    threadId: 't1',
    emailId: 'e1',
    subject: 'Offre technique',
    from: 'Nadia <nadia@client.test>',
    fromName: 'Nadia',
    receivedAt: '2026-09-25T09:00:00Z',
    ...overrides,
  };
}

describe('waitingFor', () => {
  it('uses the largest whole unit that fits', () => {
    expect(waitingFor('2026-09-28T11:59:30Z', NOW)).toBe('a minute');
    expect(waitingFor('2026-09-28T11:15:00Z', NOW)).toBe('45 minutes');
    // Whole units, rounded down: 44m50s has not waited 45 minutes.
    expect(waitingFor('2026-09-28T11:15:10Z', NOW)).toBe('44 minutes');
    expect(waitingFor('2026-09-28T11:00:00Z', NOW)).toBe('1 hour');
    expect(waitingFor('2026-09-28T01:30:00Z', NOW)).toBe('10 hours');
    expect(waitingFor('2026-09-27T12:00:01Z', NOW)).toBe('23 hours');
    expect(waitingFor('2026-09-27T12:00:00Z', NOW)).toBe('1 day');
    expect(waitingFor('2026-09-25T09:00:00Z', NOW)).toBe('3 days');
  });
});

describe('ToReplyList', () => {
  it('names who is waiting, on what, and for how long', () => {
    render(<ToReplyList items={[owed()]} loading={false} selectedThread={null} onOpen={vi.fn()} now={NOW} />);
    const row = screen.getByRole('button', { name: /Nadia/ });
    expect(row).toHaveTextContent('Offre technique');
    expect(row).toHaveTextContent('waiting 3 days');
  });

  it('falls back to the address when the sender has no name', () => {
    render(
      <ToReplyList
        items={[owed({ fromName: null, from: 'ops@client.test' })]}
        loading={false}
        selectedThread={null}
        onOpen={vi.fn()}
        now={NOW}
      />,
    );
    expect(screen.getByRole('button', { name: /ops@client\.test/ })).toBeInTheDocument();
  });

  it('opens the thread it was clicked on', async () => {
    const onOpen = vi.fn();
    render(
      <ToReplyList
        items={[owed(), owed({ threadId: 't2', emailId: 'e2', fromName: 'Karim' })]}
        loading={false}
        selectedThread={null}
        onOpen={onOpen}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Karim/ }));
    expect(onOpen).toHaveBeenCalledWith('t2');
  });

  it('keeps the server order — the longest wait first', () => {
    render(
      <ToReplyList
        items={[owed({ fromName: 'First' }), owed({ threadId: 't2', fromName: 'Second', receivedAt: '2026-09-27T09:00:00Z' })]}
        loading={false}
        selectedThread={null}
        onOpen={vi.fn()}
        now={NOW}
      />,
    );
    expect(screen.getAllByRole('button').map((b) => b.querySelector('.to-reply-item__from')?.textContent))
      .toEqual(['First', 'Second']);
  });

  it('says nobody is waiting when the list is empty', () => {
    render(<ToReplyList items={[]} loading={false} selectedThread={null} onOpen={vi.fn()} now={NOW} />);
    expect(screen.getByText('Nobody is waiting on you')).toBeInTheDocument();
  });

  it('shows loading, not "nobody is waiting", before the first answer', () => {
    render(<ToReplyList items={[]} loading selectedThread={null} onOpen={vi.fn()} now={NOW} />);
    expect(screen.queryByText('Nobody is waiting on you')).not.toBeInTheDocument();
  });
});
