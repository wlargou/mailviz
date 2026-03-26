import { useEffect, useRef } from 'react';
import {
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  eachHourOfInterval,
  startOfDay,
  endOfDay,
  isSameDay,
  isToday,
  format,
  differenceInMinutes,
  areIntervalsOverlapping,
} from 'date-fns';
import { useCalendarStore } from '../../store/calendarStore';
import type { CalendarEvent } from '../../types/calendar';
import { getEventColor } from '../../utils/eventColors';

/** Pixels per hour — taller rows so 30-min events are readable */
const PX_PER_HOUR = 72;

interface CalendarWeekViewProps {
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (date: Date) => void;
}

/** Compute column layout for overlapping events within a single day. */
function layoutDayEvents(events: CalendarEvent[]) {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => {
    const diff = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    if (diff !== 0) return diff;
    return differenceInMinutes(new Date(b.endTime), new Date(b.startTime)) -
           differenceInMinutes(new Date(a.endTime), new Date(a.startTime));
  });

  const positioned: { event: CalendarEvent; col: number; totalCols: number }[] = [];
  const columns: CalendarEvent[][] = [];

  for (const event of sorted) {
    const eStart = new Date(event.startTime);
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      const lastInCol = columns[c][columns[c].length - 1];
      const lEnd = new Date(lastInCol.endTime);
      if (eStart >= lEnd) {
        columns[c].push(event);
        positioned.push({ event, col: c, totalCols: 0 });
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([event]);
      positioned.push({ event, col: columns.length - 1, totalCols: 0 });
    }
  }

  for (const p of positioned) {
    const eStart = new Date(p.event.startTime);
    const eEnd = new Date(p.event.endTime);
    let maxCol = p.col;
    for (const other of positioned) {
      if (other.event.id === p.event.id) continue;
      const oStart = new Date(other.event.startTime);
      const oEnd = new Date(other.event.endTime);
      try {
        if (areIntervalsOverlapping({ start: eStart, end: eEnd }, { start: oStart, end: oEnd })) {
          maxCol = Math.max(maxCol, other.col);
        }
      } catch { /* skip */ }
    }
    p.totalCols = maxCol + 1;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const p of positioned) {
      const eStart = new Date(p.event.startTime);
      const eEnd = new Date(p.event.endTime);
      for (const other of positioned) {
        if (other.event.id === p.event.id) continue;
        const oStart = new Date(other.event.startTime);
        const oEnd = new Date(other.event.endTime);
        try {
          if (areIntervalsOverlapping({ start: eStart, end: eEnd }, { start: oStart, end: oEnd })) {
            const maxCols = Math.max(p.totalCols, other.totalCols);
            if (p.totalCols !== maxCols || other.totalCols !== maxCols) {
              p.totalCols = maxCols;
              other.totalCols = maxCols;
              changed = true;
            }
          }
        } catch { /* skip */ }
      }
    }
  }

  return positioned;
}

/** Format a short time range like "9 – 10:30 AM" or "2 – 3 PM" */
function formatTimeRange(start: Date, end: Date): string {
  const sameAmPm = (start.getHours() < 12) === (end.getHours() < 12);
  if (sameAmPm) {
    // Omit AM/PM from start if both are in the same period
    return `${format(start, 'h:mm')} – ${format(end, 'h:mm a')}`;
  }
  return `${format(start, 'h:mm a')} – ${format(end, 'h:mm a')}`;
}

export function CalendarWeekView({ onEventClick, onSlotClick }: CalendarWeekViewProps) {
  const { currentDate, events } = useCalendarStore();
  const bodyRef = useRef<HTMLDivElement>(null);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const hours = eachHourOfInterval({ start: startOfDay(weekStart), end: endOfDay(weekStart) });

  const allDayEvents = events.filter((e) => e.isAllDay);
  const timedEvents = events.filter((e) => !e.isAllDay);

  // Scroll to 8 AM on mount and when week changes
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 8 * PX_PER_HOUR;
    }
  }, [currentDate]);

  const getEventsForDay = (day: Date) =>
    timedEvents.filter((e) => isSameDay(new Date(e.startTime), day));

  const getAllDayForDay = (day: Date) =>
    allDayEvents.filter((e) => isSameDay(new Date(e.startTime), day));

  return (
    <div className="calendar-week">
      {/* Header */}
      <div className="calendar-week__header">
        <div className="calendar-week__gutter" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={`calendar-week__day-header ${isToday(day) ? 'calendar-week__day-header--today' : ''}`}
          >
            <span className="calendar-week__day-name">{format(day, 'EEE')}</span>
            <span className={`calendar-week__day-number ${isToday(day) ? 'calendar-week__day-number--today' : ''}`}>
              {format(day, 'd')}
            </span>
          </div>
        ))}
      </div>

      {/* All-day row */}
      <div className="calendar-week__allday">
        <div className="calendar-week__gutter">
          <span className="calendar-week__gutter-label">All day</span>
        </div>
        {days.map((day) => (
          <div key={day.toISOString()} className="calendar-week__allday-cell">
            {getAllDayForDay(day).map((event) => {
              const colors = getEventColor(event.colorId);
              return (
                <button
                  key={event.id}
                  className="calendar-event-pill"
                  style={{ background: colors.bg, color: colors.text }}
                  onClick={() => onEventClick(event)}
                  data-tooltip={event.title}
                >
                  <span className="calendar-event-pill__title">{event.title}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="calendar-week__body" ref={bodyRef}>
        <div className="calendar-week__time-grid">
          {hours.map((hour) => (
            <div key={hour.toISOString()} className="calendar-week__time-row">
              <div className="calendar-week__gutter">
                <span className="calendar-week__gutter-label">{format(hour, 'h a')}</span>
              </div>
              {days.map((day) => (
                <div
                  key={day.toISOString()}
                  className="calendar-week__cell"
                  onClick={() => {
                    const slotDate = new Date(day);
                    slotDate.setHours(hour.getHours());
                    onSlotClick(slotDate);
                  }}
                />
              ))}
            </div>
          ))}

          {/* Positioned events */}
          {days.map((day, dayIndex) => {
            const dayEvents = getEventsForDay(day);
            const layout = layoutDayEvents(dayEvents);

            return layout.map(({ event, col, totalCols }) => {
              const colors = getEventColor(event.colorId);
              const start = new Date(event.startTime);
              const end = new Date(event.endTime);
              const dayStart = startOfDay(day);
              const topMinutes = differenceInMinutes(start, dayStart);
              const durationMinutes = differenceInMinutes(end, start);
              const top = (topMinutes / 60) * PX_PER_HOUR;
              const height = Math.max((durationMinutes / 60) * PX_PER_HOUR, 22);

              // Adaptive content based on pixel height
              const showLocation = height >= 54 && event.location;
              const showTimeRange = height >= 70;
              const showConference = height >= 86 && event.conferenceLink;
              const isCompact = height < 36;

              const colWidth = `(100% - 60px) / 7`;
              const dayLeft = `calc(60px + ${dayIndex} * (${colWidth}))`;
              const eventWidth = `calc((${colWidth}) / ${totalCols} - 4px)`;
              const eventLeft = `calc(${dayLeft} + ${col} * (${colWidth}) / ${totalCols} + 2px)`;

              return (
                <button
                  key={event.id}
                  className={`calendar-week__event ${isCompact ? 'calendar-week__event--compact' : ''}`}
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                    left: eventLeft,
                    width: eventWidth,
                    background: colors.bg,
                    borderLeft: `3px solid ${colors.accent}`,
                    color: colors.text,
                  }}
                  onClick={() => onEventClick(event)}
                  data-tooltip={event.title}
                >
                  {isCompact ? (
                    // Very short event: single line with time + title
                    <span className="calendar-week__event-inline">
                      <span className="calendar-week__event-time" style={{ color: colors.text }}>
                        {format(start, 'h:mm')}
                      </span>
                      <span className="calendar-week__event-title" style={{ color: colors.text }}>
                        {event.title}
                      </span>
                    </span>
                  ) : (
                    <>
                      <span className="calendar-week__event-title" style={{ color: colors.text }}>
                        {event.title}
                      </span>
                      {showLocation && (
                        <span className="calendar-week__event-location" style={{ color: colors.textSub }}>
                          {event.location}
                        </span>
                      )}
                      {showTimeRange && (
                        <span className="calendar-week__event-timerange" style={{ color: colors.textSub }}>
                          {formatTimeRange(start, end)}
                        </span>
                      )}
                      {showConference && (
                        <span className="calendar-week__event-location" style={{ color: colors.textSub }}>
                          {event.conferenceLink}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            });
          })}
        </div>
      </div>
    </div>
  );
}
