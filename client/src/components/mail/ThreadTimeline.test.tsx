import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThreadTimeline, timelineLayout, TIMELINE } from './ThreadTimeline';
import type { EmailMessage } from '../../types/email';

/**
 * The rail beside the reader. Pinned: one marker per message, named for a
 * screen reader; unread, read and the user's own told apart; time sets the
 * spacing, within bounds, and a silence of three days or more is labelled;
 * "N new" opens the first unread; the outline covers what is on screen; one
 * marker is tabbable and the arrows walk the rest.
 */

function msg(id: string, receivedAt: string, over: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id,
    from: `${id}@acme.test`,
    fromName: `Sender ${id}`,
    receivedAt,
    snippet: `snippet ${id}`,
    isRead: true,
    attachments: [],
    ...over,
  } as EmailMessage;
}

const THREAD = [
  msg('a', '2026-09-09T10:12:00'),
  msg('b', '2026-09-10T15:30:00', { isRead: false }),
  msg('c', '2026-09-14T09:05:00', { isRead: false, attachments: [{ id: 'x' }, { id: 'y' }] as never }),
  msg('me', '2026-09-16T08:47:00', { from: 'me@powerm.test', fromName: 'L.walid' }),
  msg('d', '2026-09-24T10:59:00'),
];
const OWN = new Set(['me@powerm.test']);

function renderRail(over: Partial<Parameters<typeof ThreadTimeline>[0]> = {}) {
  const onOpen = vi.fn();
  render(<ThreadTimeline messages={THREAD} own={OWN} visibleIds={new Set()} onOpen={onOpen} {...over} />);
  return { onOpen, nav: screen.getByRole('navigation', { name: 'Thread timeline' }) };
}

const markers = (nav: HTMLElement) => within(nav).getAllByRole('button').filter((b) => b.classList.contains('thread-timeline__marker'));

describe('timelineLayout', () => {
  it('spaces messages by the time between them, within bounds', () => {
    const { y } = timelineLayout(['2026-09-01T10:00:00', '2026-09-01T10:05:00', '2026-09-03T10:00:00', '2026-12-01T10:00:00']);
    expect(y[0]).toBe(TIMELINE.top);
    const gaps = y.slice(1).map((v, i) => v - y[i]);
    // Minutes apart: the minimum. Two days: more. Three months: the maximum.
    expect(gaps[0]).toBeCloseTo(TIMELINE.minGap, 0);
    expect(gaps[1]).toBeGreaterThan(gaps[0]);
    expect(gaps[1]).toBeLessThan(TIMELINE.maxGap);
    expect(gaps[2]).toBe(TIMELINE.maxGap);
  });

  it('counts a silence from three days', () => {
    const { quiet } = timelineLayout(['2026-09-01T10:00:00', '2026-09-03T09:00:00', '2026-09-06T10:00:00']);
    expect(quiet).toEqual([null, null, 3]);
  });

  it('spaces a very long thread evenly, so it still fits', () => {
    const dates = Array.from({ length: TIMELINE.evenAbove + 1 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i * 9)).toISOString());
    const { y, height } = timelineLayout(dates);
    expect(new Set(y.slice(1).map((v, i) => v - y[i]))).toEqual(new Set([TIMELINE.evenGap]));
    expect(height).toBe(y[y.length - 1] + TIMELINE.bottom);
  });
});

describe('ThreadTimeline', () => {
  it('draws a marker per message, named, with unread, read and your own told apart', () => {
    const { nav } = renderRail();
    const all = markers(nav);

    expect(all.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Sender a, 9 Sep 10:12',
      'Sender b, 10 Sep 15:30, unread',
      'Sender c, 14 Sep 09:05, unread',
      'You, 16 Sep 08:47',
      'Sender d, 24 Sep 10:59',
    ]);
    expect(all.map((b) => b.dataset.state)).toEqual(['read', 'unread', 'unread', 'read', 'read']);
    expect(all.map((b) => b.dataset.mine ?? null)).toEqual([null, null, null, 'true', null]);
  });

  it('previews a message on its marker: who, when, the text and what is attached', () => {
    const { nav } = renderRail();
    const c = markers(nav)[2];
    const preview = document.getElementById(c.getAttribute('aria-describedby')!.split(' ')[0])!;
    expect(preview.textContent).toContain('Sender c');
    expect(preview.textContent).toContain('14 Sep, 09:05');
    expect(preview.textContent).toContain('snippet c');
    expect(preview.textContent).toContain('2 attachments · Unread');
  });

  it('opens the message of a marker clicked', async () => {
    const user = userEvent.setup();
    const { nav, onOpen } = renderRail();
    await user.click(markers(nav)[3]);
    expect(onOpen).toHaveBeenCalledWith('me');
  });

  it('counts the unread and opens the first of them', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderRail();
    await user.click(screen.getByRole('button', { name: '2 new' }));
    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('says so when everything is read', () => {
    renderRail({ messages: THREAD.map((m) => ({ ...m, isRead: true })) });
    expect(screen.getByText('All read')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new$/ })).toBeNull();
  });

  it('labels the silences of three days or more, and the days once each', () => {
    const { nav } = renderRail();
    // 10 → 14 Sep and 16 → 24 Sep; not 9 → 10 or 14 → 16.
    expect([...nav.querySelectorAll('.thread-timeline__quiet')].map((e) => e.textContent)).toEqual(['4d', '8d']);
    expect(nav.querySelectorAll('.thread-timeline__segment--quiet')).toHaveLength(2);
    expect([...nav.querySelectorAll('.thread-timeline__day')].map((e) => e.textContent)).toEqual(['9 Sep', '10 Sep', '14 Sep', '16 Sep', '24 Sep']);
  });

  it('outlines the messages on screen', () => {
    const { y } = timelineLayout(THREAD.map((m) => m.receivedAt));
    renderRail({ visibleIds: new Set(['c', 'me']) });
    const band = screen.getByTestId('timeline-band');
    expect(band.style.top).toBe(`${y[2] - 13}px`);
    expect(band.style.height).toBe(`${y[3] - y[2] + 26}px`);
  });

  it('draws no outline while nothing is on screen', () => {
    renderRail();
    expect(screen.queryByTestId('timeline-band')).toBeNull();
  });

  it('keeps one marker in the tab order — the first unread — and walks the rest with the arrows', async () => {
    const user = userEvent.setup();
    const { nav } = renderRail();
    const all = markers(nav);
    expect(all.map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1, -1]);

    all[1].focus();
    await user.keyboard('{ArrowDown}');
    expect(all[2]).toHaveFocus();
    await user.keyboard('{End}');
    expect(all[4]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(all[4]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(all[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(all[0]).toHaveFocus();
    expect(all.map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });

  it('keeps a tab stop when the thread shrinks under it', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { rerender } = render(<ThreadTimeline messages={THREAD} own={OWN} visibleIds={new Set()} onOpen={onOpen} />);
    const nav = screen.getByRole('navigation', { name: 'Thread timeline' });
    markers(nav)[1].focus();
    await user.keyboard('{End}{ArrowDown}');

    rerender(<ThreadTimeline messages={THREAD.slice(0, 3)} own={OWN} visibleIds={new Set()} onOpen={onOpen} />);
    expect(markers(nav).map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
  });
});
