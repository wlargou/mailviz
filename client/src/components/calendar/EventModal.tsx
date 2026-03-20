import { useState, useEffect } from 'react';
import {
  TextInput,
  TextArea,
  Toggle,
} from '@carbon/react';
import { CreateSidePanel } from '@carbon/ibm-products';
import { calendarApi } from '../../api/calendar';
import { useUIStore } from '../../store/uiStore';
import type { CalendarEvent } from '../../types/calendar';
import { format } from 'date-fns';

interface EventModalProps {
  open: boolean;
  event?: CalendarEvent | null;
  initialDate?: Date | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EventModal({ open, event, initialDate, onClose, onSaved }: EventModalProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const [loading, setLoading] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startDateStr, setStartDateStr] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endDateStr, setEndDateStr] = useState('');
  const [endTime, setEndTime] = useState('10:00');
  const [isAllDay, setIsAllDay] = useState(false);

  useEffect(() => {
    if (!open) return;

    if (event) {
      setTitle(event.title);
      setDescription(event.description || '');
      setLocation(event.location || '');
      const start = new Date(event.startTime);
      const end = new Date(event.endTime);
      setStartDateStr(format(start, 'MM/dd/yyyy'));
      setStartTime(format(start, 'HH:mm'));
      setEndDateStr(format(end, 'MM/dd/yyyy'));
      setEndTime(format(end, 'HH:mm'));
      setIsAllDay(event.isAllDay);
    } else {
      const base = initialDate || new Date();
      setTitle('');
      setDescription('');
      setLocation('');
      setStartDateStr(format(base, 'MM/dd/yyyy'));
      setStartTime(format(base, 'HH:mm'));
      setEndDateStr(format(base, 'MM/dd/yyyy'));
      const endHour = new Date(base);
      endHour.setHours(endHour.getHours() + 1);
      setEndTime(format(endHour, 'HH:mm'));
      setIsAllDay(false);
    }
  }, [open, event, initialDate]);

  const buildDateTime = (dateStr: string, time: string): string => {
    const parts = dateStr.split('/');
    if (parts.length !== 3) return new Date().toISOString();
    const [month, day, year] = parts.map(Number);
    const [hours, minutes] = time.split(':').map(Number);
    const d = new Date(year, month - 1, day, hours || 0, minutes || 0);
    return d.toISOString();
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setLoading(true);

    try {
      const payload = {
        title: title.trim(),
        description: description || undefined,
        location: location || undefined,
        startTime: buildDateTime(startDateStr, isAllDay ? '00:00' : startTime),
        endTime: buildDateTime(endDateStr, isAllDay ? '23:59' : endTime),
        isAllDay,
      };

      if (event) {
        await calendarApi.update(event.id, payload);
        addNotification({ kind: 'success', title: 'Event updated' });
      } else {
        await calendarApi.create(payload);
        addNotification({ kind: 'success', title: 'Event created' });
      }

      onSaved();
    } catch {
      addNotification({ kind: 'error', title: `Failed to ${event ? 'update' : 'create'} event` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <CreateSidePanel
      open={open}
      onRequestClose={onClose}
      onRequestSubmit={handleSubmit}
      title={event ? 'Edit Event' : 'New Event'}
      subtitle={event ? 'Update event details' : 'Add a new event to your calendar'}
      formTitle="Event details"
      formDescription="Set the title, time, and location for your event."
      primaryButtonText={event ? 'Save Changes' : 'Create Event'}
      secondaryButtonText="Cancel"
      disableSubmit={!title.trim() || loading}
      selectorPageContent=".app-content"
      selectorPrimaryFocus="#event-title"
    >
      <TextInput
        id="event-title"
        labelText="Title"
        placeholder="Event title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        invalid={open && title.length > 0 && !title.trim()}
        invalidText="Title is required"
        className="create-side-panel__form-item"
      />

      <Toggle
        id="event-allday"
        labelText="All day event"
        labelA="No"
        labelB="Yes"
        toggled={isAllDay}
        onToggle={(checked: boolean) => setIsAllDay(checked)}
        className="create-side-panel__form-item"
      />

      <TextInput
        id="event-start-date"
        labelText="Start Date"
        placeholder="MM/DD/YYYY"
        value={startDateStr}
        onChange={(e) => setStartDateStr(e.target.value)}
        className="create-side-panel__form-item"
      />
      {!isAllDay && (
        <TextInput
          id="event-start-time"
          labelText="Start Time"
          placeholder="HH:MM"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          className="create-side-panel__form-item"
        />
      )}

      <TextInput
        id="event-end-date"
        labelText="End Date"
        placeholder="MM/DD/YYYY"
        value={endDateStr}
        onChange={(e) => setEndDateStr(e.target.value)}
        className="create-side-panel__form-item"
      />
      {!isAllDay && (
        <TextInput
          id="event-end-time"
          labelText="End Time"
          placeholder="HH:MM"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          className="create-side-panel__form-item"
        />
      )}

      <TextInput
        id="event-location"
        labelText="Location"
        placeholder="Add location"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        className="create-side-panel__form-item"
      />

      <TextArea
        id="event-description"
        labelText="Description"
        placeholder="Add description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        className="create-side-panel__form-item"
      />
    </CreateSidePanel>
  );
}
