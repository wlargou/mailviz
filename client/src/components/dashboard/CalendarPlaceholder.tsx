import { useEffect, useState } from 'react';
import { Calendar } from '@carbon/icons-react';
import { Button, SkeletonText } from '@carbon/react';
import { useNavigate } from 'react-router-dom';
import { calendarApi } from '../../api/calendar';
import { format } from 'date-fns';
import type { CalendarEvent } from '../../types/calendar';

export function CalendarPlaceholder() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUpcoming = async () => {
      try {
        const now = new Date();
        const end = new Date();
        end.setDate(end.getDate() + 7);
        const { data: response } = await calendarApi.getAll(now.toISOString(), end.toISOString());
        setEvents(response.data.slice(0, 3));
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchUpcoming();
  }, []);

  if (loading) {
    return (
      <div>
        <SkeletonText paragraph lineCount={3} />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="placeholder-tile">
        <div className="placeholder-icon">
          <Calendar size={20} />
        </div>
        <h4>No upcoming events</h4>
        <p>Your next 7 days are clear</p>
        <Button kind="ghost" size="sm" onClick={() => navigate('/calendar')} style={{ marginTop: '0.5rem' }}>
          Open Calendar
        </Button>
      </div>
    );
  }

  return (
    <div className="upcoming-events">
      {events.map((event) => (
        <div
          key={event.id}
          className="upcoming-event"
          onClick={() => navigate('/calendar')}
        >
          <div className="upcoming-event__time">
            {event.isAllDay
              ? 'All day'
              : format(new Date(event.startTime), 'h:mm a')}
          </div>
          <div className="upcoming-event__info">
            <span className="upcoming-event__title">{event.title}</span>
            <span className="upcoming-event__date">
              {format(new Date(event.startTime), 'EEE, MMM d')}
            </span>
          </div>
        </div>
      ))}
      <Button kind="ghost" size="sm" onClick={() => navigate('/calendar')} style={{ marginTop: '0.5rem' }}>
        View all events
      </Button>
    </div>
  );
}
