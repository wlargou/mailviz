import {
  eachHourOfInterval,
  startOfDay,
  endOfDay,
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

interface CalendarDayViewProps {
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (date: Date) => void;
}

function layoutEvents(events: CalendarEvent[]) {
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
      } catch { /* skip zero-length */ }
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
    return `${format(start, 'h:mm')} – ${format(end, 'h:mm a')}`;
  }
  return `${format(start, 'h:mm a')} – ${format(end, 'h:mm a')}`;
}

export function CalendarDayView({ onEventClick, onSlotClick }: CalendarDayViewProps) {
  const { currentDate, events } = useCalendarStore();

  const dayStart = startOfDay(currentDate);
  const dayEnd = endOfDay(currentDate);
  const hours = eachHourOfInterval({ start: dayStart, end: dayEnd });

  const allDayEvents = events.filter((e) => e.isAllDay);
  const timedEvents = events.filter((e) => !e.isAllDay);
  const layout = layoutEvents(timedEvents);

  return (
    <div className="calendar-day">
      {/* Header */}
      <div className="calendar-day__header">
        <div className="calendar-day__gutter" />
        <div className={`calendar-day__day-header ${isToday(currentDate) ? 'calendar-day__day-header--today' : ''}`}>
          <span className="calendar-day__day-name">{format(currentDate, 'EEEE')}</span>
          <span className={`calendar-day__day-number ${isToday(currentDate) ? 'calendar-day__day-number--today' : ''}`}>
            {format(currentDate, 'd')}
          </span>
        </div>
      </div>

      {/* All-day row */}
      {allDayEvents.length > 0 && (
        <div className="calendar-day__allday">
          <div className="calendar-day__gutter">
            <span className="calendar-day__gutter-label">All day</span>
          </div>
          <div className="calendar-day__allday-cell">
            {allDayEvents.map((event) => {
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
        </div>
      )}

      {/* Time grid */}
      <div className="calendar-day__body">
        <div className="calendar-day__time-grid">
          {hours.map((hour) => (
            <div key={hour.toISOString()} className="calendar-day__time-row">
              <div className="calendar-day__gutter">
                <span className="calendar-day__gutter-label">{format(hour, 'h a')}</span>
              </div>
              <div
                className="calendar-day__cell"
                onClick={() => {
                  const slotDate = new Date(currentDate);
                  slotDate.setHours(hour.getHours(), 0, 0, 0);
                  onSlotClick(slotDate);
                }}
              />
            </div>
          ))}

          {/* Positioned events */}
          {layout.map(({ event, col, totalCols }) => {
            const colors = getEventColor(event.colorId);
            const start = new Date(event.startTime);
            const end = new Date(event.endTime);
            const topMinutes = differenceInMinutes(start, dayStart);
            const durationMinutes = differenceInMinutes(end, start);
            const top = (topMinutes / 60) * PX_PER_HOUR;
            const height = Math.max((durationMinutes / 60) * PX_PER_HOUR, 22);

            const showLocation = height >= 54 && event.location;
            const showTimeRange = height >= 70;
            const showConference = height >= 86 && event.conferenceLink;
            const isCompact = height < 36;

            const colWidth = `(100% - 60px) / ${totalCols}`;
            const left = `calc(60px + ${col} * (${colWidth}) + 2px)`;
            const width = `calc(${colWidth} - 4px)`;

            return (
              <button
                key={event.id}
                className={`calendar-day__event ${isCompact ? 'calendar-day__event--compact' : ''}`}
                style={{
                  top: `${top}px`,
                  height: `${height}px`,
                  left,
                  width,
                  background: colors.bg,
                  borderLeft: `3px solid ${colors.accent}`,
                  color: colors.text,
                }}
                onClick={() => onEventClick(event)}
                data-tooltip={event.title}
              >
                {isCompact ? (
                  <span className="calendar-day__event-inline">
                    <span className="calendar-day__event-time" style={{ color: colors.text }}>
                      {format(start, 'h:mm')}
                    </span>
                    <span className="calendar-day__event-title" style={{ color: colors.text }}>
                      {event.title}
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="calendar-day__event-title" style={{ color: colors.text }}>
                      {event.title}
                    </span>
                    {showLocation && (
                      <span className="calendar-day__event-location" style={{ color: colors.textSub }}>
                        {event.location}
                      </span>
                    )}
                    {showTimeRange && (
                      <span className="calendar-day__event-timerange" style={{ color: colors.textSub }}>
                        {formatTimeRange(start, end)}
                      </span>
                    )}
                    {showConference && (
                      <span className="calendar-day__event-location" style={{ color: colors.textSub }}>
                        {event.conferenceLink}
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
