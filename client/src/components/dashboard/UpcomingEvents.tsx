import { Fragment } from 'react';
import { SkeletonText, Button } from '@carbon/react';
import { useNavigate } from 'react-router-dom';
import { Calendar, ArrowRight, Launch } from '@carbon/icons-react';
import { format, isToday, isTomorrow } from 'date-fns';
import type { DashboardStats } from '../../types/dashboard';
import { EmptyState } from '../shared/EmptyState';

interface UpcomingEventsProps {
  stats: DashboardStats | null;
  loading: boolean;
  onEventClick?: (eventId: string) => void;
}

/** "Today", "Tomorrow", then the weekday and date. */
export function eventDayLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'EEEE d MMM');
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
      <EmptyState
        size="sm"
        icon={<Calendar size={20} />}
        title="No upcoming events"
        action={
          <Button kind="ghost" size="sm" onClick={() => navigate('/calendar')}>
            Open Calendar
          </Button>
        }
      />
    );
  }

  return (
    <div className="upcoming-events">
      {upcomingEvents.slice(0, 5).map((event, i, shown) => {
        const startDate = new Date(event.startTime);
        const today = isToday(startDate);
        const openEvent = () => (onEventClick ? onEventClick(event.id) : navigate('/calendar'));
        // A heading each time the day changes. Without one, today's 11:30
        // was followed by tomorrow's 11:00 and read as a sorting bug.
        const day = eventDayLabel(startDate);
        const newDay = i === 0 || eventDayLabel(new Date(shown[i - 1].startTime)) !== day;

        return (
          <Fragment key={event.id}>
          {newDay && <h5 className="upcoming-events__day">{day}</h5>}
          {/* Stays a div with role="button" rather than a real <button>: the
              row can contain a nested "Join" Button and buttons cannot nest. */}
          <div
            role="button"
            tabIndex={0}
            aria-label={`${event.title}, ${event.isAllDay ? 'all day' : format(startDate, 'h:mm a')}`}
            className={`upcoming-event${today ? ' upcoming-event--today' : ''}`}
            onClick={openEvent}
            onKeyDown={(e) => {
              // Ignore keys bubbling up from the nested Join button.
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openEvent();
              }
            }}
          >
            <div className="upcoming-event__time">
              {event.isAllDay
                ? 'All day'
                : format(startDate, 'h:mm a')}
            </div>
            <div className="upcoming-event__info">
              <span className="upcoming-event__title">{event.title}</span>
            </div>
            {event.conferenceLink && (
              <Button
                kind="primary"
                size="sm"
                renderIcon={Launch}
                className="upcoming-event__join-btn"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  window.open(event.conferenceLink!, '_blank');
                }}
              >
                Join
              </Button>
            )}
          </div>
          </Fragment>
        );
      })}
      <Button kind="ghost" size="sm" renderIcon={ArrowRight} onClick={() => navigate('/calendar')} className="recent-activity__view-all">
        View all events
      </Button>
    </div>
  );
}
