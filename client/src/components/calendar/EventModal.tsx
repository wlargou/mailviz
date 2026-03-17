import { useState, useEffect } from 'react';
import {
  Modal,
  TextInput,
  TextArea,
  DatePicker,
  DatePickerInput,
  TimePicker,
  Toggle,
} from '@carbon/react';
import { calendarApi } from '../../api/calendar';
import { useUIStore } from '../../store/uiStore';
import type { CalendarEvent } from '../../types/calendar';
import { format, set as setDate, parseISO } from 'date-fns';

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
    // Parse date from MM/dd/yyyy format
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
    <Modal
      open={open}
      modalHeading={event ? 'Edit Event' : 'New Event'}
      primaryButtonText={event ? 'Save Changes' : 'Create Event'}
      secondaryButtonText="Cancel"
      onRequestSubmit={handleSubmit}
      onRequestClose={onClose}
      primaryButtonDisabled={!title.trim() || loading}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <TextInput
          id="event-title"
          labelText="Title"
          placeholder="Event title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <Toggle
          id="event-allday"
          labelText="All day event"
          labelA="No"
          labelB="Yes"
          toggled={isAllDay}
          onToggle={(checked: boolean) => setIsAllDay(checked)}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <TextInput
            id="event-start-date"
            labelText="Start Date"
            placeholder="MM/DD/YYYY"
            value={startDateStr}
            onChange={(e) => setStartDateStr(e.target.value)}
          />
          {!isAllDay && (
            <TextInput
              id="event-start-time"
              labelText="Start Time"
              placeholder="HH:MM"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <TextInput
            id="event-end-date"
            labelText="End Date"
            placeholder="MM/DD/YYYY"
            value={endDateStr}
            onChange={(e) => setEndDateStr(e.target.value)}
          />
          {!isAllDay && (
            <TextInput
              id="event-end-time"
              labelText="End Time"
              placeholder="HH:MM"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          )}
        </div>

        <TextInput
          id="event-location"
          labelText="Location"
          placeholder="Add location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />

        <TextArea
          id="event-description"
          labelText="Description"
          placeholder="Add description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>
    </Modal>
  );
}
