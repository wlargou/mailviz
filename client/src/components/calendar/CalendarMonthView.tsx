import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
} from 'date-fns';
import { CalendarDayCell } from './CalendarDayCell';
import { useCalendarStore } from '../../store/calendarStore';
import type { CalendarEvent } from '../../types/calendar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface CalendarMonthViewProps {
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

export function CalendarMonthView({ onDayClick, onEventClick }: CalendarMonthViewProps) {
  const { currentDate, events } = useCalendarStore();

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
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
            onDayClick={onDayClick}
            onEventClick={onEventClick}
          />
        ))}
      </div>
    </div>
  );
}
