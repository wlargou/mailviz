import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { Tearsheet } from '@carbon/ibm-products';
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

const DURATION_OPTIONS = [
  { id: '15', label: '15 minutes', minutes: 15 },
  { id: '30', label: '30 minutes', minutes: 30 },
  { id: '45', label: '45 minutes', minutes: 45 },
  { id: '60', label: '1 hour', minutes: 60 },
  { id: '90', label: '1 hour 30 min', minutes: 90 },
  { id: '120', label: '2 hours', minutes: 120 },
  { id: '180', label: '3 hours', minutes: 180 },
  { id: 'custom', label: 'Custom', minutes: 0 },
];

// ─── Recurrence ───────────────────────────────────
// We offer a fixed set of presets rather than a full RRULE builder. Anything
// outside these presets is shown read-only so an existing rule is never
// silently rewritten into something simpler than what the user set elsewhere.
type RecurrencePresetId = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

interface RecurrenceOption {
  id: RecurrencePresetId;
  label: string;
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/** Build the RFC 5545 lines Google expects for a preset, anchored on the start date. */
function buildRecurrenceRules(presetId: RecurrencePresetId, start: Date): string[] {
  switch (presetId) {
    case 'daily':
      return ['RRULE:FREQ=DAILY'];
    case 'weekly':
      return [`RRULE:FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES[start.getDay()]}`];
    case 'monthly':
      return [`RRULE:FREQ=MONTHLY;BYMONTHDAY=${start.getDate()}`];
    case 'yearly':
      return ['RRULE:FREQ=YEARLY'];
    case 'none':
    default:
      return [];
  }
}

function buildRecurrenceOptions(start: Date): RecurrenceOption[] {
  return [
    { id: 'none', label: 'Does not repeat' },
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: `Weekly on ${format(start, 'EEEE')}` },
    { id: 'monthly', label: `Monthly on day ${start.getDate()}` },
    { id: 'yearly', label: `Yearly on ${format(start, 'MMMM d')}` },
  ];
}

/**
 * Map an existing recurrence back onto a preset, or null when the rule is
 * richer than our presets (INTERVAL, COUNT, UNTIL, multiple BYDAYs, EXDATEs…).
 */
function parseRecurrencePreset(rules: string[], start: Date): RecurrencePresetId | null {
  if (rules.length === 0) return 'none';
  if (rules.length > 1) return null;

  const rule = rules[0].trim().toUpperCase();
  if (!rule.startsWith('RRULE:')) return null;

  const params = new Map<string, string>();
  for (const part of rule.slice('RRULE:'.length).split(';')) {
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx <= 0) return null;
    params.set(part.slice(0, idx), part.slice(idx + 1));
  }

  const freq = params.get('FREQ');
  if (!freq) return null;

  // Only the qualifier our own presets emit is representable.
  const qualifier = freq === 'WEEKLY' ? 'BYDAY' : freq === 'MONTHLY' ? 'BYMONTHDAY' : null;
  for (const key of params.keys()) {
    if (key !== 'FREQ' && key !== qualifier) return null;
  }

  switch (freq) {
    case 'DAILY':
      return 'daily';
    case 'WEEKLY': {
      const byDay = params.get('BYDAY');
      return !byDay || byDay === WEEKDAY_CODES[start.getDay()] ? 'weekly' : null;
    }
    case 'MONTHLY': {
      const byMonthDay = params.get('BYMONTHDAY');
      return !byMonthDay || byMonthDay === String(start.getDate()) ? 'monthly' : null;
    }
    case 'YEARLY':
      return 'yearly';
    default:
      return null;
  }
}

function detectMeetingProvider(url: string): string | null {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('meet.google.com')) return 'Google Meet';
  if (lower.includes('zoom.us') || lower.includes('zoom.com')) return 'Zoom';
  if (lower.includes('teams.microsoft.com') || lower.includes('teams.live.com')) return 'Microsoft Teams';
  if (lower.includes('webex.com')) return 'Webex';
  return null;
}

function to12h(time24: string): { time: string; ampm: string } {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { time: `${h12}:${String(m).padStart(2, '0')}`, ampm };
}

function to24h(time12: string, ampm: string): string {
  const match = time12.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '09:00';
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Parse date string "MM/dd/yyyy" and time "HH:mm" into a Date object */
function parseDateTime(dateStr: string, time24: string): Date {
  const parts = dateStr.split('/');
  if (parts.length !== 3) return new Date();
  const [month, day, year] = parts.map(Number);
  const [hours, minutes] = time24.split(':').map(Number);
  return new Date(year, month - 1, day, hours || 0, minutes || 0);
}

/** Calculate duration in minutes between start and end */
function calcDuration(startDateStr: string, startTime24: string, endDateStr: string, endTime24: string): number {
  const start = parseDateTime(startDateStr, startTime24);
  const end = parseDateTime(endDateStr, endTime24);
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

/** Find matching duration option or 'custom' */
function matchDuration(minutes: number): string {
  const match = DURATION_OPTIONS.find((d) => d.minutes === minutes);
  return match ? match.id : 'custom';
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
  const [durationId, setDurationId] = useState('60');
  const [isCustomEnd, setIsCustomEnd] = useState(false);

  // Recurrence. `lockedRecurrence` non-null means the event's existing rule
  // can't be expressed as a preset (or belongs to a parent series), so we show
  // it read-only and leave it untouched on save.
  const [recurrencePresetId, setRecurrencePresetId] = useState<RecurrencePresetId>('none');
  const [lockedRecurrence, setLockedRecurrence] = useState<string[] | null>(null);

  // Guests
  const [attendeeInput, setAttendeeInput] = useState('');
  const [attendees, setAttendees] = useState<Array<{ email: string; name?: string }>>([]);
  const [sendUpdates, setSendUpdates] = useState<'all' | 'none'>('all');
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Conference & color
  const [addGoogleMeet, setAddGoogleMeet] = useState(false);
  const [colorId, setColorId] = useState<string | null>(null);

  const meetingProvider = detectMeetingProvider(location);

  // Recurrence rules and labels are anchored on the currently selected start
  // date, so changing the date re-points "Weekly on …" / "Monthly on day …".
  const recurrenceAnchor = useMemo(() => parseDateTime(startDateStr, '00:00'), [startDateStr]);
  const recurrenceOptions = useMemo(() => buildRecurrenceOptions(recurrenceAnchor), [recurrenceAnchor]);
  const selectedRecurrence =
    recurrenceOptions.find((o) => o.id === recurrencePresetId) || recurrenceOptions[0];

  // Compute end time from start + duration
  const updateEndFromDuration = useCallback(
    (startDate: string, startT12: string, startAP: string, durMinutes: number) => {
      const start24 = to24h(startT12, startAP);
      const startDt = parseDateTime(startDate, start24);
      const endDt = new Date(startDt.getTime() + durMinutes * 60000);
      setEndDateStr(format(endDt, 'MM/dd/yyyy'));
      const end12 = to12h(format(endDt, 'HH:mm'));
      setEndTime12(end12.time);
      setEndAmPm(end12.ampm);
    },
    []
  );

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

      // Detect duration
      const durMin = Math.round((end.getTime() - start.getTime()) / 60000);
      const matched = matchDuration(durMin);
      setDurationId(matched);
      setIsCustomEnd(matched === 'custom');

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

      // An event carrying a recurringEventId is one instance of a series — its
      // rule lives on the master event, so it is never editable from here.
      const rules = event.recurrence || [];
      const preset = event.recurringEventId ? null : parseRecurrencePreset(rules, start);
      setRecurrencePresetId(preset ?? 'none');
      setLockedRecurrence(preset === null ? rules : null);
    } else {
      const base = initialDate || new Date();
      // Round to next 30min
      const mins = base.getMinutes();
      if (mins > 0 && mins <= 30) base.setMinutes(30);
      else if (mins > 30) { base.setHours(base.getHours() + 1); base.setMinutes(0); }
      base.setSeconds(0);

      setTitle('');
      setDescription('');
      setLocation('');
      setStartDateStr(format(base, 'MM/dd/yyyy'));
      const s12 = to12h(format(base, 'HH:mm'));
      setStartTime12(s12.time);
      setStartAmPm(s12.ampm);
      setIsAllDay(false);
      setDurationId('60');
      setIsCustomEnd(false);
      setAttendees([]);
      setAttendeeInput('');
      setSendUpdates('all');
      setAddGoogleMeet(false);
      setColorId(null);
      setContactResults([]);
      setShowContactDropdown(false);
      setRecurrencePresetId('none');
      setLockedRecurrence(null);

      // Set end = start + 1h
      const endDt = new Date(base.getTime() + 60 * 60000);
      setEndDateStr(format(endDt, 'MM/dd/yyyy'));
      const e12 = to12h(format(endDt, 'HH:mm'));
      setEndTime12(e12.time);
      setEndAmPm(e12.ampm);
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

  // When start date changes, auto-update end date to maintain same duration
  const handleStartDateChange = (dates: Date[]) => {
    if (!dates[0]) return;
    const newStartDateStr = format(dates[0], 'MM/dd/yyyy');
    setStartDateStr(newStartDateStr);

    if (!isCustomEnd) {
      const dur = DURATION_OPTIONS.find((d) => d.id === durationId);
      if (dur && dur.minutes > 0) {
        updateEndFromDuration(newStartDateStr, startTime12, startAmPm, dur.minutes);
      }
    } else {
      // Keep end date in sync (same offset)
      setEndDateStr(newStartDateStr);
    }
  };

  // When start time changes, recalculate end time from duration
  const handleStartTimeChange = (newTime12: string, newAmPm?: string) => {
    const t = newTime12;
    const ap = newAmPm || startAmPm;
    setStartTime12(t);
    if (newAmPm !== undefined) setStartAmPm(ap);

    if (!isCustomEnd) {
      const dur = DURATION_OPTIONS.find((d) => d.id === durationId);
      if (dur && dur.minutes > 0) {
        updateEndFromDuration(startDateStr, t, ap, dur.minutes);
      }
    }
  };

  // When duration selection changes
  const handleDurationChange = (selectedId: string) => {
    setDurationId(selectedId);
    if (selectedId === 'custom') {
      setIsCustomEnd(true);
      return;
    }
    setIsCustomEnd(false);
    const dur = DURATION_OPTIONS.find((d) => d.id === selectedId);
    if (dur) {
      updateEndFromDuration(startDateStr, startTime12, startAmPm, dur.minutes);
    }
  };

  const buildDateTime = (dateStr: string, time: string): string => {
    const d = parseDateTime(dateStr, time);
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
        // Omitted entirely when the existing rule is locked, so the server
        // leaves whatever Google has in place.
        recurrence:
          lockedRecurrence === null
            ? buildRecurrenceRules(recurrencePresetId, recurrenceAnchor)
            : undefined,
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
    <Tearsheet
      open={open}
      onClose={onClose}
      title={event ? 'Edit Event' : 'New Event'}
      label="Calendar"
      description={event ? 'Update event details' : 'Add a new event to your calendar'}
      hasCloseIcon
      selectorsFloatingMenus={['.cds--date-picker__calendar']}
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
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
        invalid={open && title.length > 0 && !title.trim()}
        invalidText="Title is required"
        className="tearsheet-form__item"
      />

      {/* 2. All-day toggle */}
      <Toggle
        id="event-allday"
        labelText="All day event"
        labelA="No"
        labelB="Yes"
        toggled={isAllDay}
        onToggle={(checked: boolean) => setIsAllDay(checked)}
        className="tearsheet-form__item"
      />

      {/* 3. Start date + time */}
      <div className="event-modal__date-row tearsheet-form__item">
        <DatePicker
          datePickerType="single"
          dateFormat="m/d/Y"
          value={startDateStr}
          onChange={handleStartDateChange}
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
            onChange={(e) => handleStartTimeChange(e.target.value)}
          >
            <TimePickerSelect
              id="event-start-ampm"
              aria-label="AM/PM"
              value={startAmPm}
              onChange={(e) => handleStartTimeChange(startTime12, e.target.value)}
            >
              <SelectItem value="AM" text="AM" />
              <SelectItem value="PM" text="PM" />
            </TimePickerSelect>
          </TimePicker>
        )}
      </div>

      {/* 4. Duration + End time */}
      {!isAllDay && (
        <div className="event-modal__date-row tearsheet-form__item">
          <Dropdown
            id="event-duration"
            titleText="Duration"
            label="Duration"
            items={DURATION_OPTIONS}
            itemToString={(item) => item?.label || ''}
            selectedItem={DURATION_OPTIONS.find((d) => d.id === durationId) || DURATION_OPTIONS[7]}
            onChange={({ selectedItem }) => {
              if (selectedItem) handleDurationChange(selectedItem.id);
            }}
          />
          {isCustomEnd && (
            <TimePicker
              id="event-end-time"
              labelText="End time"
              value={endTime12}
              onChange={(e) => setEndTime12(e.target.value)}
            >
              <TimePickerSelect
                id="event-end-ampm"
                aria-label="AM/PM"
                value={endAmPm}
                onChange={(e) => setEndAmPm(e.target.value)}
              >
                <SelectItem value="AM" text="AM" />
                <SelectItem value="PM" text="PM" />
              </TimePickerSelect>
            </TimePicker>
          )}
        </div>
      )}

      {/* End date (for multi-day all-day events or custom end) */}
      {(isAllDay || isCustomEnd) && (
        <div className="event-modal__date-row tearsheet-form__item">
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
        </div>
      )}

      {/* 5. Recurrence */}
      {lockedRecurrence === null ? (
        <Dropdown
          id="event-recurrence"
          titleText="Repeat"
          label="Does not repeat"
          items={recurrenceOptions}
          itemToString={(item: RecurrenceOption | null) => item?.label || ''}
          selectedItem={selectedRecurrence}
          onChange={({ selectedItem }) => {
            if (selectedItem) setRecurrencePresetId(selectedItem.id);
          }}
          className="tearsheet-form__item"
        />
      ) : (
        <div className="tearsheet-form__item event-modal__recurrence-locked">
          <span className="event-modal__recurrence-locked-title">Repeat</span>
          <code className="event-modal__recurrence-rule">
            {lockedRecurrence.length > 0
              ? lockedRecurrence.join(' · ')
              : 'Part of a recurring series'}
          </code>
          <span className="event-modal__recurrence-locked-hint">
            This recurrence can't be edited here and will be left unchanged. Change it in Google
            Calendar.
          </span>
        </div>
      )}

      {/* 6. Add guests — contact search */}
      <div className="tearsheet-form__item event-modal__guests" ref={dropdownRef}>
        <TextInput
          id="attendee-input"
          labelText="Add guests"
          placeholder="Search contacts or type email..."
          value={attendeeInput}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setAttendeeInput(e.target.value);
            searchContacts(e.target.value);
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
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

      {/* 7. Notify attendees toggle */}
      {attendees.length > 0 && (
        <Toggle
          id="notify-attendees"
          labelText="Notify attendees"
          labelA="No"
          labelB="Yes"
          toggled={sendUpdates === 'all'}
          onToggle={(checked) => setSendUpdates(checked ? 'all' : 'none')}
          className="tearsheet-form__item"
        />
      )}

      {/* 8. Location */}
      <div className="tearsheet-form__item">
        <TextInput
          id="event-location"
          labelText="Location"
          placeholder="Room, address, or meeting link"
          value={location}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocation(e.target.value)}
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

      {/* 9. Google Meet toggle */}
      <Toggle
        id="add-google-meet"
        labelText="Add Google Meet video conferencing"
        labelA="Off"
        labelB="On"
        toggled={addGoogleMeet}
        onToggle={(checked) => setAddGoogleMeet(checked)}
        className="tearsheet-form__item"
      />
      {event?.conferenceLink && (
        <div className="event-modal__conference-link">
          <VideoChat size={16} />
          <a href={event.conferenceLink} target="_blank" rel="noopener noreferrer">
            {detectMeetingProvider(event.conferenceLink) || 'Meeting'} — {event.conferenceLink}
          </a>
        </div>
      )}

      {/* 10. Color dropdown */}
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
        className="tearsheet-form__item"
      />

      {/* 11. Description */}
      <TextArea
        id="event-description"
        labelText="Description"
        placeholder="Add description"
        value={description}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
        rows={3}
        className="tearsheet-form__item"
      />
    </Tearsheet>
  );
}
