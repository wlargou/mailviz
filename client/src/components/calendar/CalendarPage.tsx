import { useEffect, useRef, useState, useMemo } from 'react';
import { Grid, Column } from '@carbon/react';
import { useCalendarStore } from '../../store/calendarStore';
import { calendarApi } from '../../api/calendar';
import { useUIStore } from '../../store/uiStore';
import { useEmailWebSocket } from '../../hooks/useEmailWebSocket';
import { CalendarToolbar } from './CalendarToolbar';
import { CalendarMonthView } from './CalendarMonthView';
import { CalendarWeekView } from './CalendarWeekView';
import { CalendarDayView } from './CalendarDayView';
import { EventModal } from './EventModal';
import { EventDetailModal } from './EventDetailModal';
import { EventTooltip } from './EventTooltip';
import type { CalendarEvent } from '../../types/calendar';

export function CalendarPage() {
  const { viewMode, fetchEvents, fetchGoogleStatus, syncing, goToDay } = useCalendarStore();
  const addNotification = useUIStore((s) => s.addNotification);

  const [createOpen, setCreateOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [initialDate, setInitialDate] = useState<Date | null>(null);

  // Ref for silent refetch from WS handlers (avoids stale closure)
  const fetchEventsRef = useRef(fetchEvents);
  fetchEventsRef.current = fetchEvents;

  // Real-time calendar sync via WebSocket
  const wsHandlers = useMemo(() => ({
    'calendar:synced': () => fetchEventsRef.current?.(true),
    'calendar:sync:status': (data: { syncing: boolean }) => {
      useCalendarStore.setState({ syncing: data.syncing });
    },
  }), []);

  useEmailWebSocket(wsHandlers);

  useEffect(() => {
    fetchEvents();
    fetchGoogleStatus();
  }, [fetchEvents, fetchGoogleStatus]);

  const handleDayClick = (date: Date) => {
    goToDay(date);
  };

  const handleSlotClick = (date: Date) => {
    setInitialDate(date);
    setEditEvent(null);
    setCreateOpen(true);
  };

  const handleEventClick = (event: CalendarEvent) => {
    setDetailEvent(event);
  };

  const handleEditFromDetail = (event: CalendarEvent) => {
    setDetailEvent(null);
    setEditEvent(event);
    setCreateOpen(true);
  };

  const handleDelete = async (event: CalendarEvent, mode: 'single' | 'all' = 'single') => {
    try {
      await calendarApi.delete(event.id, mode);
      addNotification({ kind: 'success', title: mode === 'all' ? 'Recurring series deleted' : 'Event deleted' });
      setDetailEvent(null);
      fetchEvents();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete event' });
    }
  };

  const handleRespond = async (event: CalendarEvent, response: 'accepted' | 'declined' | 'tentative') => {
    try {
      const { data: result } = await calendarApi.respond(event.id, response);
      addNotification({ kind: 'success', title: `Responded: ${response}` });
      setDetailEvent(result.data);
      fetchEvents();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to respond to event' });
    }
  };

  const handleSaved = () => {
    setCreateOpen(false);
    setEditEvent(null);
    fetchEvents();
  };

  return (
    <div className="calendar-page">
      <div className="page-header">
        <div className="page-header__info">
          <h1>Calendar</h1>
          <p className="page-header__subtitle">Manage your schedule and events</p>
        </div>
      </div>

      <Grid fullWidth>
        <Column lg={16} md={8} sm={4}>
          <CalendarToolbar onAddEvent={() => { setEditEvent(null); setInitialDate(null); setCreateOpen(true); }} />

          <div className="calendar-page__view">
            {viewMode === 'month' && (
              <CalendarMonthView onDayClick={handleDayClick} onEventClick={handleEventClick} />
            )}
            {viewMode === 'week' && (
              <CalendarWeekView onSlotClick={handleSlotClick} onEventClick={handleEventClick} />
            )}
            {viewMode === 'day' && (
              <CalendarDayView onSlotClick={handleSlotClick} onEventClick={handleEventClick} />
            )}
          </div>
        </Column>
      </Grid>

      <EventModal
        open={createOpen}
        event={editEvent}
        initialDate={initialDate}
        onClose={() => { setCreateOpen(false); setEditEvent(null); }}
        onSaved={handleSaved}
      />

      <EventTooltip />

      <EventDetailModal
        event={detailEvent}
        open={!!detailEvent}
        onClose={() => setDetailEvent(null)}
        onEdit={handleEditFromDetail}
        onDelete={handleDelete}
        onRespond={handleRespond}
      />
    </div>
  );
}
