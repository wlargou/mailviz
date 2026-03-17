import { Button, ContentSwitcher, Switch } from '@carbon/react';
import { ChevronLeft, ChevronRight, Add, Renew } from '@carbon/icons-react';
import { format } from 'date-fns';
import { useCalendarStore } from '../../store/calendarStore';
import type { CalendarViewMode } from '../../types/calendar';

interface CalendarToolbarProps {
  onAddEvent: () => void;
}

export function CalendarToolbar({ onAddEvent }: CalendarToolbarProps) {
  const { currentDate, viewMode, syncing, googleStatus, navigate, setViewMode, syncEvents } =
    useCalendarStore();

  const periodLabel =
    viewMode === 'month'
      ? format(currentDate, 'MMMM yyyy')
      : viewMode === 'week'
        ? `Week of ${format(currentDate, 'MMM d, yyyy')}`
        : format(currentDate, 'EEEE, MMMM d, yyyy');

  const viewIndex = viewMode === 'month' ? 0 : viewMode === 'week' ? 1 : 2;

  return (
    <div className="calendar-toolbar">
      <div className="calendar-toolbar__nav">
        <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronLeft} iconDescription="Previous" onClick={() => navigate('prev')} />
        <Button kind="ghost" size="sm" onClick={() => navigate('today')}>
          Today
        </Button>
        <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronRight} iconDescription="Next" onClick={() => navigate('next')} />
        <h3 className="calendar-toolbar__period">{periodLabel}</h3>
      </div>
      <div className="calendar-toolbar__actions">
        <ContentSwitcher
          onChange={(e) => setViewMode(String(e.name) as CalendarViewMode)}
          selectedIndex={viewIndex}
          size="sm"
        >
          <Switch name="month" text="Month" />
          <Switch name="week" text="Week" />
          <Switch name="day" text="Day" />
        </ContentSwitcher>
        {googleStatus?.connected && (
          <Button
            kind="ghost"
            size="sm"
            hasIconOnly
            renderIcon={Renew}
            iconDescription="Sync"
            disabled={syncing}
            onClick={syncEvents}
          />
        )}
        <Button size="sm" renderIcon={Add} onClick={onAddEvent}>
          Add Event
        </Button>
      </div>
    </div>
  );
}
