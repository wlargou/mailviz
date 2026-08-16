import { useState, useRef, useEffect } from 'react';
import { isSameDay, isSameMonth, isToday, format } from 'date-fns';
import { createPortal } from 'react-dom';
import type { CalendarEvent } from '../../types/calendar';
import { getEventColor } from '../../utils/eventColors';

interface CalendarDayCellProps {
  date: Date;
  currentMonth: Date;
  events: CalendarEvent[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

interface OverflowPopoverProps {
  events: CalendarEvent[];
  date: Date;
  anchorRect: DOMRect;
  onEventClick: (event: CalendarEvent) => void;
  onClose: () => void;
}

function OverflowPopover({ events, date, anchorRect, onEventClick, onClose }: OverflowPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay listener to avoid closing immediately from the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // The popover is portalled to <body>, so it is nowhere near the trigger in tab
  // order. Move focus into it on open; CalendarDayCell returns focus to the
  // trigger on close.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Position the popover near the anchor, adjusting to stay in viewport
  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 300);
  const left = Math.min(anchorRect.left, window.innerWidth - 260);

  return createPortal(
    <div
      ref={popoverRef}
      className="calendar-overflow-popover"
      role="dialog"
      aria-label={`Events on ${format(date, 'EEEE, MMMM d')}`}
      style={{ top, left }}
    >
      <div className="calendar-overflow-popover__header">
        <span className="calendar-overflow-popover__date">
          {format(date, 'EEEE, MMMM d')}
        </span>
        <button
          ref={closeRef}
          type="button"
          className="calendar-overflow-popover__close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="calendar-overflow-popover__events">
        {events.map((event) => {
          const colors = getEventColor(event.colorId);

          if (event.isAllDay) {
            return (
              <button
                key={event.id}
                type="button"
                className="calendar-event-pill"
                style={{ background: colors.bg, color: colors.text }}
                onClick={() => { onEventClick(event); onClose(); }}
              >
                <span className="calendar-event-pill__title">{event.title}</span>
              </button>
            );
          }

          return (
            <button
              key={event.id}
              type="button"
              className="calendar-event-dot"
              onClick={() => { onEventClick(event); onClose(); }}
            >
              <span className="calendar-event-dot__dot" style={{ background: colors.dot }} />
              <span className="calendar-event-dot__time">
                {format(new Date(event.startTime), 'h:mm a')}
              </span>
              <span className="calendar-event-dot__title">{event.title}</span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}

export function CalendarDayCell({ date, currentMonth, events, onDayClick, onEventClick }: CalendarDayCellProps) {
  const dayEvents = events.filter((e) => isSameDay(new Date(e.startTime), date));
  const isCurrentMonth = isSameMonth(date, currentMonth);
  const today = isToday(date);

  const [showOverflow, setShowOverflow] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  // Separate all-day and timed events
  const allDayEvents = dayEvents.filter((e) => e.isAllDay);
  const timedEvents = dayEvents.filter((e) => !e.isAllDay);

  // Show up to 6 items total (all-day pills first, then timed)
  const maxVisible = 6;
  const allItems = [...allDayEvents, ...timedEvents];
  const visible = allItems.slice(0, maxVisible);
  const overflowItems = allItems.slice(maxVisible);
  const overflowCount = overflowItems.length;

  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (moreRef.current) {
      setAnchorRect(moreRef.current.getBoundingClientRect());
    }
    setShowOverflow(true);
  };

  const closeOverflow = () => {
    setShowOverflow(false);
    // Return focus to the trigger — the popover is portalled to <body>.
    moreRef.current?.focus();
  };

  return (
    // Stays a div with role="button" rather than a real <button>: the cell
    // contains event buttons and buttons cannot be nested.
    <div
      role="button"
      tabIndex={0}
      aria-label={`Go to ${format(date, 'EEEE, MMMM d, yyyy')}`}
      className={`calendar-day-cell ${!isCurrentMonth ? 'calendar-day-cell--muted' : ''} ${today ? 'calendar-day-cell--today' : ''}`}
      onClick={() => onDayClick(date)}
      onKeyDown={(e) => {
        // Ignore keys bubbling up from the nested event / "+N more" buttons.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onDayClick(date);
        }
      }}
    >
      <span className={`calendar-day-cell__number ${today ? 'calendar-day-cell__number--today' : ''}`}>
        {format(date, 'd')}
      </span>
      <div className="calendar-day-cell__events">
        {visible.map((event) => {
          const colors = getEventColor(event.colorId);

          if (event.isAllDay) {
            // All-day: colored pill
            return (
              <button
                key={event.id}
                type="button"
                className="calendar-event-pill"
                style={{ background: colors.bg, color: colors.text }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEventClick(event);
                }}
                data-tooltip={event.title}
              >
                <span className="calendar-event-pill__title">{event.title}</span>
              </button>
            );
          }

          // Timed: dot + time + title
          return (
            <button
              key={event.id}
              type="button"
              className="calendar-event-dot"
              onClick={(e) => {
                e.stopPropagation();
                onEventClick(event);
              }}
              data-tooltip={event.title}
            >
              <span className="calendar-event-dot__dot" style={{ background: colors.dot }} />
              <span className="calendar-event-dot__time">
                {format(new Date(event.startTime), 'h:mm')}
              </span>
              <span className="calendar-event-dot__title">{event.title}</span>
            </button>
          );
        })}
        {overflowCount > 0 && (
          <button
            ref={moreRef}
            type="button"
            className="calendar-day-cell__more"
            aria-haspopup="dialog"
            aria-expanded={showOverflow}
            aria-label={`Show ${overflowCount} more events on ${format(date, 'EEEE, MMMM d')}`}
            onClick={handleMoreClick}
          >
            +{overflowCount} more
          </button>
        )}
      </div>
      {showOverflow && anchorRect && (
        <OverflowPopover
          events={allItems}
          date={date}
          anchorRect={anchorRect}
          onEventClick={onEventClick}
          onClose={closeOverflow}
        />
      )}
    </div>
  );
}
