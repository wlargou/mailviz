import { isSameDay, isSameMonth, isToday, format } from 'date-fns';
import type { CalendarEvent } from '../../types/calendar';
import { getEventColor } from '../../utils/eventColors';

interface CalendarDayCellProps {
  date: Date;
  currentMonth: Date;
  events: CalendarEvent[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

export function CalendarDayCell({ date, currentMonth, events, onDayClick, onEventClick }: CalendarDayCellProps) {
  const dayEvents = events.filter((e) => isSameDay(new Date(e.startTime), date));
  const isCurrentMonth = isSameMonth(date, currentMonth);
  const today = isToday(date);

  // Separate all-day and timed events
  const allDayEvents = dayEvents.filter((e) => e.isAllDay);
  const timedEvents = dayEvents.filter((e) => !e.isAllDay);

  // Show up to 3 items total (all-day pills first, then timed)
  const maxVisible = 3;
  const allItems = [...allDayEvents, ...timedEvents];
  const visible = allItems.slice(0, maxVisible);
  const overflow = allItems.length - maxVisible;

  return (
    <div
      className={`calendar-day ${!isCurrentMonth ? 'calendar-day--muted' : ''} ${today ? 'calendar-day--today' : ''}`}
      onClick={() => onDayClick(date)}
    >
      <span className={`calendar-day__number ${today ? 'calendar-day__number--today' : ''}`}>
        {format(date, 'd')}
      </span>
      <div className="calendar-day__events">
        {visible.map((event) => {
          const colors = getEventColor(event.colorId);

          if (event.isAllDay) {
            // All-day: colored pill
            return (
              <button
                key={event.id}
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
        {overflow > 0 && (
          <span className="calendar-day__more">+{overflow} more</span>
        )}
      </div>
    </div>
  );
}
