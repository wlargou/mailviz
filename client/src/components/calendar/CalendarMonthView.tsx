import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
} from 'date-fns';
import { CalendarDayCell } from './CalendarDayCell';
import { useCalendarStore, visibleDeadlines, visibleEvents } from '../../store/calendarStore';
import type { CalendarEvent } from '../../types/calendar';
import { WEEK_STARTS_ON } from '../../utils/week';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface CalendarMonthViewProps {
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

export function CalendarMonthView({ onDayClick, onEventClick }: CalendarMonthViewProps) {
  // Derived from the whole state, not selected: a selector returning a new
  // array each call would re-render without end.
  const calendar = useCalendarStore();
  const { currentDate } = calendar;
  const events = visibleEvents(calendar);
  const deadlines = visibleDeadlines(calendar);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: WEEK_STARTS_ON });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  return (
    <div className="calendar-month">
      <div className="calendar-month__header">
        {WEEKDAYS.map((day) => (
          <div key={day} className="calendar-month__weekday">
            {day}
          </div>
        ))}
      </div>
      <div className="calendar-month__grid">
        {days.map((day) => (
          <CalendarDayCell
            key={day.toISOString()}
            date={day}
            currentMonth={currentDate}
            events={events}
            deadlines={deadlines}
            onDayClick={onDayClick}
            onEventClick={onEventClick}
          />
        ))}
      </div>
    </div>
  );
}
