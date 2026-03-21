import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TextInput,
  TextArea,
  Toggle,
  Tag,
  Dropdown,
  DatePicker,
  DatePickerInput,
  TimePicker,
  TimePickerSelect,
  SelectItem,
} from '@carbon/react';
import { SidePanel } from '@carbon/ibm-products';
import { Launch, VideoChat } from '@carbon/icons-react';
import { calendarApi } from '../../api/calendar';
import { contactsApi } from '../../api/contacts';
import { useUIStore } from '../../store/uiStore';
import type { CalendarEvent } from '../../types/calendar';
import type { Contact } from '../../types/customer';
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

/** Detect if a location string is a meeting link and return the provider label */
function detectMeetingProvider(url: string): string | null {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('meet.google.com')) return 'Google Meet';
  if (lower.includes('zoom.us') || lower.includes('zoom.com')) return 'Zoom';
  if (lower.includes('teams.microsoft.com') || lower.includes('teams.live.com')) return 'Microsoft Teams';
  if (lower.includes('webex.com')) return 'Webex';
  return null;
}

/** Convert 24h time "14:30" to 12h format { time: "2:30", ampm: "PM" } */
function to12h(time24: string): { time: string; ampm: string } {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { time: `${h12}:${String(m).padStart(2, '0')}`, ampm };
}

/** Convert 12h format back to 24h "HH:mm" */
function to24h(time12: string, ampm: string): string {
  const match = time12.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '09:00';
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

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
  const [startTime12, setStartTime12] = useState('9:00');
  const [startAmPm, setStartAmPm] = useState('AM');
  const [endDateStr, setEndDateStr] = useState('');
  const [endTime12, setEndTime12] = useState('10:00');
  const [endAmPm, setEndAmPm] = useState('AM');
  const [isAllDay, setIsAllDay] = useState(false);

  // Guests
  const [attendeeInput, setAttendeeInput] = useState('');
  const [attendees, setAttendees] = useState<Array<{ email: string; name?: string }>>([]);
  const [sendUpdates, setSendUpdates] = useState<'all' | 'none'>('all');
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Conference & color
  const [addGoogleMeet, setAddGoogleMeet] = useState(false);
  const [colorId, setColorId] = useState<string | null>(null);

  // Detect meeting link in location
  const meetingProvider = detectMeetingProvider(location);

  useEffect(() => {
    if (!open) return;

    if (event) {
      setTitle(event.title);
      setDescription(event.description || '');
      setLocation(event.location || '');
      const start = new Date(event.startTime);
      const end = new Date(event.endTime);
      setStartDateStr(format(start, 'MM/dd/yyyy'));
      const s12 = to12h(format(start, 'HH:mm'));
      setStartTime12(s12.time);
      setStartAmPm(s12.ampm);
      setEndDateStr(format(end, 'MM/dd/yyyy'));
      const e12 = to12h(format(end, 'HH:mm'));
      setEndTime12(e12.time);
      setEndAmPm(e12.ampm);
      setIsAllDay(event.isAllDay);

      if (event.attendees) {
        const existing = (event.attendees as any[])
          .filter((a: any) => !a.self)
          .map((a: any) => ({ email: a.email, name: a.displayName || undefined }));
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
      const s12 = to12h(format(base, 'HH:mm'));
      setStartTime12(s12.time);
      setStartAmPm(s12.ampm);
      setEndDateStr(format(base, 'MM/dd/yyyy'));
      const endHour = new Date(base);
      endHour.setHours(endHour.getHours() + 1);
      const e12 = to12h(format(endHour, 'HH:mm'));
      setEndTime12(e12.time);
      setEndAmPm(e12.ampm);
      setIsAllDay(false);
      setAttendees([]);
      setAttendeeInput('');
      setSendUpdates('all');
      setAddGoogleMeet(false);
      setColorId(null);
      setContactResults([]);
      setShowContactDropdown(false);
    }
  }, [open, event, initialDate]);

  // Close contact dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowContactDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Search contacts as user types
  const searchContacts = useCallback((query: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (query.length < 2) {
      setContactResults([]);
      setShowContactDropdown(false);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await contactsApi.search(query, 8);
        const contacts = res.data.data || [];
        // Filter out contacts already added
        const filtered = contacts.filter(
          (c) => c.email && !attendees.find((a) => a.email === c.email)
        );
        setContactResults(filtered);
        setShowContactDropdown(filtered.length > 0);
      } catch {
        setContactResults([]);
      }
    }, 250);
  }, [attendees]);

  const addAttendee = (email: string, name?: string) => {
    if (email && !attendees.find((a) => a.email === email)) {
      setAttendees([...attendees, { email, name }]);
    }
    setAttendeeInput('');
    setShowContactDropdown(false);
    setContactResults([]);
  };

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

    const startTime24 = to24h(startTime12, startAmPm);
    const endTime24 = to24h(endTime12, endAmPm);

    try {
      const payload = {
        title: title.trim(),
        description: description || undefined,
        location: location || undefined,
        startTime: buildDateTime(startDateStr, isAllDay ? '00:00' : startTime24),
        endTime: buildDateTime(endDateStr, isAllDay ? '23:59' : endTime24),
        isAllDay,
        attendees: attendees.length > 0 ? attendees.map((a) => ({ email: a.email })) : undefined,
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
    <SidePanel
      open={open}
      onRequestClose={onClose}
      title={event ? 'Edit Event' : 'New Event'}
      subtitle={event ? 'Update event details' : 'Add a new event to your calendar'}
      size="lg"
      actions={[
        {
          label: event ? 'Save Changes' : 'Create Event',
          onClick: handleSubmit,
          kind: 'primary' as const,
          disabled: !title.trim() || loading,
          loading,
        },
        {
          label: 'Cancel',
          onClick: onClose,
          kind: 'secondary' as const,
        },
      ]}
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
          <TimePicker
            id="event-start-time"
            labelText="Start time"
            value={startTime12}
            onChange={(e: any) => setStartTime12(e.target.value)}
          >
            <TimePickerSelect
              id="event-start-ampm"
              labelText="AM/PM"
              value={startAmPm}
              onChange={(e: any) => setStartAmPm(e.target.value)}
            >
              <SelectItem value="AM" text="AM" />
              <SelectItem value="PM" text="PM" />
            </TimePickerSelect>
          </TimePicker>
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
          <TimePicker
            id="event-end-time"
            labelText="End time"
            value={endTime12}
            onChange={(e: any) => setEndTime12(e.target.value)}
          >
            <TimePickerSelect
              id="event-end-ampm"
              labelText="AM/PM"
              value={endAmPm}
              onChange={(e: any) => setEndAmPm(e.target.value)}
            >
              <SelectItem value="AM" text="AM" />
              <SelectItem value="PM" text="PM" />
            </TimePickerSelect>
          </TimePicker>
        )}
      </div>

      {/* 5. Add guests — contact search */}
      <div className="create-side-panel__form-item event-modal__guests" ref={dropdownRef}>
        <TextInput
          id="attendee-input"
          labelText="Add guests"
          placeholder="Search contacts or type email..."
          value={attendeeInput}
          onChange={(e) => {
            setAttendeeInput(e.target.value);
            searchContacts(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const email = attendeeInput.trim();
              if (email && email.includes('@')) {
                addAttendee(email);
              }
            }
            if (e.key === 'Escape') {
              setShowContactDropdown(false);
            }
          }}
          autoComplete="off"
        />
        {/* Contact search dropdown */}
        {showContactDropdown && contactResults.length > 0 && (
          <div className="event-modal__contact-dropdown">
            {contactResults.map((contact) => (
              <button
                key={contact.id}
                type="button"
                className="event-modal__contact-item"
                onClick={() => {
                  if (contact.email) {
                    addAttendee(contact.email, `${contact.firstName} ${contact.lastName}`.trim());
                  }
                }}
              >
                <span className="event-modal__contact-name">
                  {contact.firstName} {contact.lastName}
                </span>
                <span className="event-modal__contact-email">{contact.email}</span>
                {contact.customer && (
                  <span className="event-modal__contact-company">{contact.customer.name}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {/* Attendee tags */}
        {attendees.length > 0 && (
          <div className="event-modal__attendees">
            {attendees.map((att) => (
              <Tag
                key={att.email}
                type="cool-gray"
                size="sm"
                filter
                onClose={() => setAttendees(attendees.filter((a) => a.email !== att.email))}
              >
                {att.name || att.email}
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
      <div className="create-side-panel__form-item">
        <TextInput
          id="event-location"
          labelText="Location"
          placeholder="Room, address, or meeting link"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        {meetingProvider && (
          <div className="event-modal__meeting-detected">
            <VideoChat size={16} />
            <span>{meetingProvider} meeting link detected</span>
            <a href={location} target="_blank" rel="noopener noreferrer" className="event-modal__meeting-join">
              <Launch size={14} />
              Join
            </a>
          </div>
        )}
      </div>

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
          <VideoChat size={16} />
          <a href={event.conferenceLink} target="_blank" rel="noopener noreferrer">
            {detectMeetingProvider(event.conferenceLink) || 'Meeting'} — {event.conferenceLink}
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
        selectedItem={EVENT_COLORS.find((c) => c.id === colorId) || COLOR_ITEMS[0]}
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
    </SidePanel>
  );
}
