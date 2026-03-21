import { useState, useEffect } from 'react';
import {
  TextInput,
  TextArea,
  Toggle,
  Tag,
  Dropdown,
  DatePicker,
  DatePickerInput,
} from '@carbon/react';
import { CreateSidePanel } from '@carbon/ibm-products';
import { calendarApi } from '../../api/calendar';
import { useUIStore } from '../../store/uiStore';
import type { CalendarEvent } from '../../types/calendar';
import { format } from 'date-fns';

const EVENT_COLORS = [
  { id: '1', label: 'Lavender', hex: '#7986CB' },
  { id: '2', label: 'Sage', hex: '#33B679' },
  { id: '3', label: 'Grape', hex: '#8E24AA' },
  { id: '4', label: 'Flamingo', hex: '#E67C73' },
  { id: '5', label: 'Banana', hex: '#F6BF26' },
  { id: '6', label: 'Tangerine', hex: '#F4511E' },
  { id: '7', label: 'Peacock', hex: '#039BE5' },
  { id: '8', label: 'Graphite', hex: '#616161' },
  { id: '9', label: 'Blueberry', hex: '#3F51B5' },
  { id: '10', label: 'Basil', hex: '#0B8043' },
  { id: '11', label: 'Tomato', hex: '#D50000' },
];

const COLOR_ITEMS = [{ id: '', label: 'Default', hex: '' }, ...EVENT_COLORS];

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

  const [attendeeInput, setAttendeeInput] = useState('');
  const [attendees, setAttendees] = useState<Array<{ email: string }>>([]);
  const [sendUpdates, setSendUpdates] = useState<'all' | 'none'>('all');
  const [addGoogleMeet, setAddGoogleMeet] = useState(false);
  const [colorId, setColorId] = useState<string | null>(null);

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

      // Pre-populate attendees (filter out self)
      if (event.attendees) {
        const existing = (event.attendees as any[]).filter(a => !a.self).map(a => ({ email: a.email }));
        setAttendees(existing);
      } else {
        setAttendees([]);
      }

      setColorId(event.colorId || null);
      setAddGoogleMeet(false);
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
      setAttendees([]);
      setAttendeeInput('');
      setSendUpdates('all');
      setAddGoogleMeet(false);
      setColorId(null);
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
        attendees: attendees.length > 0 ? attendees : undefined,
        sendUpdates: attendees.length > 0 ? sendUpdates : undefined,
        addGoogleMeet: addGoogleMeet || undefined,
        colorId: colorId || undefined,
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
      {/* 1. Title */}
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

      {/* 2. All-day toggle */}
      <Toggle
        id="event-allday"
        labelText="All day event"
        labelA="No"
        labelB="Yes"
        toggled={isAllDay}
        onToggle={(checked: boolean) => setIsAllDay(checked)}
        className="create-side-panel__form-item"
      />

      {/* 3. Start date + time */}
      <div className="event-modal__date-row create-side-panel__form-item">
        <DatePicker
          datePickerType="single"
          dateFormat="m/d/Y"
          value={startDateStr}
          onChange={(dates: Date[]) => {
            if (dates[0]) setStartDateStr(format(dates[0], 'MM/dd/yyyy'));
          }}
        >
          <DatePickerInput
            id="event-start-date"
            labelText="Start date"
            placeholder="mm/dd/yyyy"
          />
        </DatePicker>
        {!isAllDay && (
          <TextInput
            id="event-start-time"
            labelText="Start time"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        )}
      </div>

      {/* 4. End date + time */}
      <div className="event-modal__date-row create-side-panel__form-item">
        <DatePicker
          datePickerType="single"
          dateFormat="m/d/Y"
          value={endDateStr}
          onChange={(dates: Date[]) => {
            if (dates[0]) setEndDateStr(format(dates[0], 'MM/dd/yyyy'));
          }}
        >
          <DatePickerInput
            id="event-end-date"
            labelText="End date"
            placeholder="mm/dd/yyyy"
          />
        </DatePicker>
        {!isAllDay && (
          <TextInput
            id="event-end-time"
            labelText="End time"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        )}
      </div>

      {/* 5. Add guests */}
      <div className="create-side-panel__form-item">
        <TextInput
          id="attendee-input"
          labelText="Add guests"
          placeholder="Enter email and press Enter"
          value={attendeeInput}
          onChange={(e) => setAttendeeInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const email = attendeeInput.trim();
              if (email && email.includes('@') && !attendees.find(a => a.email === email)) {
                setAttendees([...attendees, { email }]);
                setAttendeeInput('');
              }
            }
          }}
        />
        {attendees.length > 0 && (
          <div className="event-modal__attendees">
            {attendees.map((att) => (
              <Tag
                key={att.email}
                type="cool-gray"
                size="sm"
                filter
                onClose={() => setAttendees(attendees.filter(a => a.email !== att.email))}
              >
                {att.email}
              </Tag>
            ))}
          </div>
        )}
      </div>

      {/* 6. Notify attendees toggle (conditional) */}
      {attendees.length > 0 && (
        <Toggle
          id="notify-attendees"
          labelText="Notify attendees"
          labelA="No"
          labelB="Yes"
          toggled={sendUpdates === 'all'}
          onToggle={(checked) => setSendUpdates(checked ? 'all' : 'none')}
          className="create-side-panel__form-item"
        />
      )}

      {/* 7. Location */}
      <TextInput
        id="event-location"
        labelText="Location"
        placeholder="Add location"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        className="create-side-panel__form-item"
      />

      {/* 8. Google Meet toggle */}
      <Toggle
        id="add-google-meet"
        labelText="Add Google Meet video conferencing"
        labelA="Off"
        labelB="On"
        toggled={addGoogleMeet}
        onToggle={(checked) => setAddGoogleMeet(checked)}
        className="create-side-panel__form-item"
      />
      {event?.conferenceLink && (
        <div className="event-modal__conference-link">
          <a href={event.conferenceLink} target="_blank" rel="noopener noreferrer">
            {event.conferenceLink}
          </a>
        </div>
      )}

      {/* 9. Color dropdown */}
      <Dropdown
        id="event-color"
        titleText="Color"
        label="Default"
        items={COLOR_ITEMS}
        itemToString={(item) => item?.label || ''}
        itemToElement={(item) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {item.hex && (
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: item.hex,
                  display: 'inline-block',
                }}
              />
            )}
            {item.label}
          </span>
        )}
        selectedItem={EVENT_COLORS.find(c => c.id === colorId) || COLOR_ITEMS[0]}
        onChange={({ selectedItem }) => setColorId(selectedItem?.id || null)}
        className="create-side-panel__form-item"
      />

      {/* 10. Description */}
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
