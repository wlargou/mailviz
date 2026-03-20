import { SkeletonText, Button } from '@carbon/react';
import { useNavigate } from 'react-router-dom';
import { Calendar, ArrowRight } from '@carbon/icons-react';
import { format, isToday } from 'date-fns';
import type { DashboardStats } from '../../types/dashboard';

interface UpcomingEventsProps {
  stats: DashboardStats | null;
  loading: boolean;
  onEventClick?: (eventId: string) => void;
}

export function UpcomingEvents({ stats, loading, onEventClick }: UpcomingEventsProps) {
  const navigate = useNavigate();

  if (loading || !stats) {
    return (
      <div>
        <SkeletonText paragraph lineCount={3} />
      </div>
    );
  }

  const { upcomingEvents, eventsToday } = stats.calendar;

  if (upcomingEvents.length === 0) {
    return (
      <div className="card-empty">
        <Calendar size={20} />
        <p>No upcoming events</p>
        <Button kind="ghost" size="sm" onClick={() => navigate('/calendar')}>
          Open Calendar
        </Button>
      </div>
    );
  }

  return (
    <div className="upcoming-events">
      {eventsToday > 0 && (
        <div className="upcoming-events__section-header">
          {eventsToday} event{eventsToday !== 1 ? 's' : ''} today
        </div>
      )}
      {upcomingEvents.map((event) => {
        const startDate = new Date(event.startTime);
        const today = isToday(startDate);

        return (
          <div
            key={event.id}
            className={`upcoming-event${today ? ' upcoming-event--today' : ''}`}
            onClick={() => onEventClick ? onEventClick(event.id) : navigate('/calendar')}
          >
            <div className="upcoming-event__time">
              {event.isAllDay
                ? 'All day'
                : format(startDate, 'h:mm a')}
            </div>
            <div className="upcoming-event__info">
              <span className="upcoming-event__title">{event.title}</span>
              <span className="upcoming-event__date">
                {today ? 'Today' : format(startDate, 'EEE, MMM d')}
              </span>
              {event.location && (
                <span className="upcoming-event__location">{event.location}</span>
              )}
            </div>
          </div>
        );
      })}
      <Button kind="ghost" size="sm" renderIcon={ArrowRight} onClick={() => navigate('/calendar')} className="recent-activity__view-all">
        View all events
      </Button>
    </div>
  );
}
