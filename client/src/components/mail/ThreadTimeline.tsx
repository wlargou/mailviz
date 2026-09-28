import { useState, useRef } from 'react';
import { Tooltip, OperationalTag } from '@carbon/react';
import { format } from 'date-fns';
import type { EmailMessage } from '../../types/email';
import { decodeEntities } from '../../utils/text';

/**
 * The thread at a glance, beside the reader: one marker per message, oldest
 * at the top, spaced by the time between them — a long silence is a long,
 * dashed stretch labelled with its days. Unread messages are filled in the
 * same blue as the unread bar on their cards, read ones hollow, the user's
 * own replies diamonds. An outline marks the messages on screen, so the rail
 * doubles as a scrollbar; a marker previews its message on hover or focus and
 * opens it on a click, hidden behind "N earlier messages" or not.
 */

/** Pixels. The gaps grow with the log of the days between messages. */
export const TIMELINE = {
  top: 44,
  bottom: 24,
  minGap: 34,
  maxGap: 78,
  /** Past this many messages the spacing is even, so a long thread still fits. */
  evenAbove: 40,
  evenGap: 18,
  /** A silence this long, in days, is drawn dashed and labelled. */
  quietDays: 3,
} as const;

export interface TimelineLayout {
  /** Each marker's centre, from the top of the rail. */
  y: number[];
  /** Days of silence before each message when it counts as quiet, else null. */
  quiet: Array<number | null>;
  height: number;
}

export function timelineLayout(dates: string[]): TimelineLayout {
  const even = dates.length > TIMELINE.evenAbove;
  const y: number[] = [];
  const quiet: Array<number | null> = [];
  dates.forEach((date, k) => {
    if (k === 0) {
      y.push(TIMELINE.top);
      quiet.push(null);
      return;
    }
    const days = Math.max(0, (Date.parse(date) - Date.parse(dates[k - 1])) / 86_400_000);
    const gap = even
      ? TIMELINE.evenGap
      : Math.min(TIMELINE.maxGap, Math.max(TIMELINE.minGap, TIMELINE.minGap + 16 * Math.log1p(days)));
    y.push(y[k - 1] + gap);
    quiet.push(days >= TIMELINE.quietDays ? Math.round(days) : null);
  });
  return { y, quiet, height: (y[y.length - 1] ?? TIMELINE.top) + TIMELINE.bottom };
}

function Marker({ unread, mine }: { unread: boolean; mine: boolean }) {
  if (unread) {
    return (
      <svg width="12" height="12" aria-hidden="true">
        <circle cx="6" cy="6" r="5.5" className="thread-timeline__dot--unread" />
      </svg>
    );
  }
  if (mine) {
    return (
      <svg width="12" height="12" aria-hidden="true">
        <rect x="3" y="3" width="6" height="6" transform="rotate(45 6 6)" className="thread-timeline__dot--mine" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" className="thread-timeline__dot--read" />
    </svg>
  );
}

interface ThreadTimelineProps {
  /** The whole thread, oldest first — including messages the reader folds away. */
  messages: EmailMessage[];
  /** The user's addresses: their messages are drawn as replies. */
  own: Set<string>;
  /** Messages on screen in the reader. */
  visibleIds: Set<string>;
  onOpen: (id: string) => void;
}

export function ThreadTimeline({ messages, own, visibleIds, onOpen }: ThreadTimelineProps) {
  const layout = timelineLayout(messages.map((m) => m.receivedAt));
  const unread = messages.filter((m) => !m.isRead);
  const navRef = useRef<HTMLElement | null>(null);
  // One marker in the tab order; the arrows move between them.
  const [focusIndex, setFocusIndex] = useState(() => {
    const first = messages.findIndex((m) => !m.isRead);
    return first >= 0 ? first : messages.length - 1;
  });
  // Held to the rail: the arrows can step past its end, and a thread can shrink.
  const tabIndex = Math.min(focusIndex, messages.length - 1);

  const moveFocus = (e: React.KeyboardEvent) => {
    const keys: Record<string, (i: number) => number> = {
      ArrowDown: (i) => i + 1,
      ArrowUp: (i) => i - 1,
      Home: () => 0,
      End: () => messages.length - 1,
    };
    const step = keys[e.key];
    if (!step) return;
    e.preventDefault();
    // No wrapping. The bottom end is held where `tabIndex` is read.
    const next = Math.max(0, step(tabIndex));
    setFocusIndex(next);
    navRef.current?.querySelectorAll<HTMLButtonElement>('.thread-timeline__marker')[next]?.focus();
  };

  const onScreen = messages.map((m, k) => (visibleIds.has(m.id) ? k : -1)).filter((k) => k >= 0);
  const band = onScreen.length > 0 ? { from: layout.y[onScreen[0]], to: layout.y[onScreen[onScreen.length - 1]] } : null;

  return (
    <nav
      ref={navRef}
      className="thread-timeline"
      aria-label="Thread timeline"
      style={{ height: layout.height }}
      onKeyDown={moveFocus}
    >
      <div className="thread-timeline__head">
        {unread.length > 0 ? (
          <OperationalTag type="blue" size="sm" text={`${unread.length} new`} onClick={() => onOpen(unread[0].id)} />
        ) : (
          <span className="thread-timeline__all-read">All read</span>
        )}
      </div>

      {messages.slice(1).map((m, i) => {
        const k = i + 1;
        const days = layout.quiet[k];
        return (
          <div key={`seg-${m.id}`}>
            <span
              className={`thread-timeline__segment${days !== null ? ' thread-timeline__segment--quiet' : ''}`}
              style={{ top: layout.y[k - 1], height: layout.y[k] - layout.y[k - 1] }}
            />
            {days !== null && layout.y[k] - layout.y[k - 1] >= 30 && (
              <span className="thread-timeline__quiet" style={{ top: (layout.y[k - 1] + layout.y[k]) / 2 }}>
                {days}d
              </span>
            )}
          </div>
        );
      })}

      {band && (
        <span
          className="thread-timeline__band"
          data-testid="timeline-band"
          style={{ top: band.from - 13, height: band.to - band.from + 26 }}
        />
      )}

      {messages.map((m, k) => {
        const date = new Date(m.receivedAt);
        const day = format(date, 'd MMM');
        // A day is labelled where it starts; even at their closest, markers
        // are 18px apart, room enough for a 12px label.
        const label = k === 0 || day !== format(new Date(messages[k - 1].receivedAt), 'd MMM');
        const mine = own.has(m.from.toLowerCase());
        const who = mine ? 'You' : decodeEntities(m.fromName || m.from);
        const when = `${day} ${format(date, 'HH:mm')}`;
        return (
          <div key={m.id}>
            {label && (
              <span className="thread-timeline__day" style={{ top: layout.y[k] }}>
                {day}
              </span>
            )}
            <div className="thread-timeline__slot" style={{ top: layout.y[k] }}>
              <Tooltip
                align="right"
                autoAlign
                description={
                  <span className="thread-timeline__preview">
                    <span className="thread-timeline__preview-head">
                      <strong>{who}</strong>
                      <span>{format(date, 'd MMM, HH:mm')}</span>
                    </span>
                    <span className="thread-timeline__preview-text">{decodeEntities(m.snippet) || '(No content)'}</span>
                    {(m.attachments.length > 0 || !m.isRead) && (
                      <span className="thread-timeline__preview-meta">
                        {m.attachments.length > 0 && `${m.attachments.length} attachment${m.attachments.length === 1 ? '' : 's'}`}
                        {m.attachments.length > 0 && !m.isRead && ' · '}
                        {!m.isRead && 'Unread'}
                      </span>
                    )}
                  </span>
                }
              >
                <button
                  type="button"
                  className="thread-timeline__marker"
                  data-state={m.isRead ? 'read' : 'unread'}
                  data-mine={mine || undefined}
                  aria-label={`${who}, ${when}${m.isRead ? '' : ', unread'}`}
                  tabIndex={k === tabIndex ? 0 : -1}
                  onFocus={() => setFocusIndex(k)}
                  onClick={() => onOpen(m.id)}
                >
                  <Marker unread={!m.isRead} mine={mine} />
                </button>
              </Tooltip>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
