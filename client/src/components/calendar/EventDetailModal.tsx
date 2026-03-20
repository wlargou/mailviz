import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Modal,
  Button,
  Tag,
  RadioButtonGroup,
  RadioButton,
} from '@carbon/react';
import { SidePanel } from '@carbon/ibm-products';
import { Edit, TrashCan, Location, Time, UserMultiple, Launch, Checkmark, Close, Help, EventSchedule, Repeat, User, Enterprise, ChevronDown, ChevronUp } from '@carbon/icons-react';
import { format } from 'date-fns';
import type { CalendarEvent, EventAttendee } from '../../types/calendar';

type ResponseStatus = EventAttendee['responseStatus'];

interface EventDetailModalProps {
  event: CalendarEvent | null;
  open: boolean;
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent, mode: 'single' | 'all') => void;
  onRespond: (event: CalendarEvent, response: 'accepted' | 'declined' | 'tentative') => Promise<void>;
}

const RESPONSE_TAG: Record<ResponseStatus, { color: 'green' | 'red' | 'cool-gray' | 'blue'; label: string }> = {
  accepted: { color: 'green', label: 'Accepted' },
  declined: { color: 'red', label: 'Declined' },
  tentative: { color: 'cool-gray', label: 'Tentative' },
  needsAction: { color: 'blue', label: 'Pending' },
};

const RESPONSE_ICON: Record<ResponseStatus, typeof Checkmark> = {
  accepted: Checkmark,
  declined: Close,
  tentative: Help,
  needsAction: EventSchedule,
};

function getMeetingLabel(url: string): string {
  if (url.includes('meet.google.com')) return 'Google Meet';
  if (url.includes('zoom.us') || url.includes('zoom.com')) return 'Zoom';
  if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'Teams';
  if (url.includes('webex.com')) return 'Webex';
  return 'Meeting';
}

const DAY_NAMES: Record<string, string> = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday',
  FR: 'Friday', SA: 'Saturday', SU: 'Sunday',
};

function parseRecurrence(rules: string[]): string | null {
  const rrule = rules.find((r) => r.startsWith('RRULE:'));
  if (!rrule) return null;

  const parts = rrule.replace('RRULE:', '').split(';');
  const params: Record<string, string> = {};
  for (const part of parts) {
    const [key, value] = part.split('=');
    params[key] = value;
  }

  const freq = params.FREQ;
  const interval = params.INTERVAL ? parseInt(params.INTERVAL, 10) : 1;
  const byDay = params.BYDAY;
  const count = params.COUNT ? parseInt(params.COUNT, 10) : undefined;
  const until = params.UNTIL;

  let label = '';

  switch (freq) {
    case 'DAILY':
      label = interval === 1 ? 'Every day' : `Every ${interval} days`;
      break;
    case 'WEEKLY': {
      if (interval === 1) {
        if (byDay) {
          const days = byDay.split(',').map((d) => DAY_NAMES[d] || d).join(', ');
          label = `Weekly on ${days}`;
        } else {
          label = 'Every week';
        }
      } else {
        label = `Every ${interval} weeks`;
        if (byDay) {
          const days = byDay.split(',').map((d) => DAY_NAMES[d] || d).join(', ');
          label += ` on ${days}`;
        }
      }
      break;
    }
    case 'MONTHLY':
      label = interval === 1 ? 'Every month' : `Every ${interval} months`;
      break;
    case 'YEARLY':
      label = interval === 1 ? 'Every year' : `Every ${interval} years`;
      break;
    default:
      return null;
  }

  if (count) {
    label += `, ${count} times`;
  } else if (until) {
    try {
      const year = until.substring(0, 4);
      const month = until.substring(4, 6);
      const day = until.substring(6, 8);
      label += `, until ${month}/${day}/${year}`;
    } catch {
      // skip
    }
  }

  return label;
}

function extractDomain(email: string): string | null {
  const at = email.indexOf('@');
  if (at < 0) return null;
  return email.substring(at + 1).toLowerCase();
}

const GOV_EDU_SLDS = new Set(['gov', 'gob', 'government', 'edu', 'ac', 'mil', 'org']);

function normalizeDomain(domain: string): string {
  const parts = domain.split('.');
  if (parts.length <= 2) return domain;
  // gov/edu pattern: org.gov.cc
  if (parts.length >= 3) {
    const sld = parts[parts.length - 2];
    const cctld = parts[parts.length - 1];
    if (GOV_EDU_SLDS.has(sld) && /^[a-z]{2}$/.test(cctld)) {
      return parts.slice(-3).join('.');
    }
  }
  return parts.slice(-2).join('.');
}

interface AttendeeGroup {
  key: string;
  label: string;
  logoUrl: string | null;
  customerId: string | null;
  attendees: EventAttendee[];
}

/** Parse description text: linkify URLs, strip angle-bracket wrappers, preserve line breaks */
function renderDescription(text: string) {
  // Clean up angle-bracket wrapped URLs: <https://...> → https://...
  const cleaned = text.replace(/<(https?:\/\/[^>]+)>/g, '$1');

  // Split into lines, then linkify URLs within each line
  const urlRegex = /(https?:\/\/[^\s<]+)/g;

  return cleaned.split('\n').map((line, lineIdx) => {
    if (!line.trim()) return <br key={lineIdx} />;

    const parts: (string | JSX.Element)[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    urlRegex.lastIndex = 0;
    while ((match = urlRegex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }
      const url = match[1];
      // Show a short label for long URLs
      const label = url.length > 60 ? url.slice(0, 57) + '...' : url;
      parts.push(
        <a key={`${lineIdx}-${match.index}`} href={url} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return <p key={lineIdx}>{parts}</p>;
  });
}

export function EventDetailModal({ event, open, onClose, onEdit, onDelete, onRespond }: EventDetailModalProps) {
  const navigate = useNavigate();
  const [responding, setResponding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'single' | 'all'>('single');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Build a domain→customer lookup from linked customers
  const customerByDomain = useMemo(() => {
    const map = new Map<string, { id: string; name: string; domain: string; logoUrl: string | null }>();
    if (event?.customers) {
      for (const { customer } of event.customers) {
        if (customer.domain) {
          map.set(customer.domain, customer as { id: string; name: string; domain: string; logoUrl: string | null });
        }
      }
    }
    return map;
  }, [event?.customers]);

  const attendeesWithoutSelf = useMemo(() => event?.attendees?.filter((a) => !a.self) || [], [event?.attendees]);

  // Group attendees by customer
  const attendeeGroups = useMemo((): AttendeeGroup[] => {
    if (attendeesWithoutSelf.length === 0) return [];

    const groups = new Map<string, AttendeeGroup>();

    for (const att of attendeesWithoutSelf) {
      const rawDomain = extractDomain(att.email);
      const domain = rawDomain ? normalizeDomain(rawDomain) : null;
      const customer = domain ? customerByDomain.get(domain) : null;

      const key = customer ? customer.id : (domain || 'unknown');
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: customer ? customer.name : (domain || 'Other'),
          logoUrl: customer?.logoUrl || null,
          customerId: customer?.id || null,
          attendees: [],
        });
      }
      groups.get(key)!.attendees.push(att);
    }

    // Sort: groups with a linked customer first, then alphabetical
    return Array.from(groups.values()).sort((a, b) => {
      if (a.customerId && !b.customerId) return -1;
      if (!a.customerId && b.customerId) return 1;
      return a.label.localeCompare(b.label);
    });
  }, [attendeesWithoutSelf, customerByDomain]);

  if (!event) return null;

  const start = new Date(event.startTime);
  const end = new Date(event.endTime);

  const timeDisplay = event.isAllDay
    ? format(start, 'EEEE, MMMM d, yyyy') + ' (All day)'
    : `${format(start, 'EEEE, MMMM d, yyyy')} · ${format(start, 'h:mm a')} – ${format(end, 'h:mm a')}`;

  const organizer = event.attendees?.find((a) => a.organizer) || null;
  const selfAttendee = event.attendees?.find((a) => a.self) || null;
  const canRespond = !!event.googleEventId && !!selfAttendee;

  const recurrence = event.recurrence ?? [];
  const isRecurring = recurrence.length > 0 || !!event.recurringEventId;
  const recurrenceLabel = recurrence.length > 0 ? parseRecurrence(recurrence) : null;

  const handleRespond = async (response: 'accepted' | 'declined' | 'tentative') => {
    setResponding(true);
    try {
      await onRespond(event, response);
    } finally {
      setResponding(false);
    }
  };

  return (
    <>
      <SidePanel
        open={open && !confirmDelete}
        onRequestClose={onClose}
        title={event.title}
        size="md"
        className="event-detail-panel"
      >
        <div className="event-detail">
          {/* Meta info grid */}
          <div className="event-detail__meta">
            <div className="event-detail__meta-item">
              <Time size={16} />
              <span>{timeDisplay}</span>
            </div>
            {isRecurring && (
              <div className="event-detail__meta-item">
                <Repeat size={16} />
                <span>{recurrenceLabel || 'Recurring event'}</span>
              </div>
            )}
            {event.location && (
              <div className="event-detail__meta-item">
                <Location size={16} />
                <span>{event.location}</span>
              </div>
            )}
            {organizer && (
              <div className="event-detail__meta-item">
                <User size={16} />
                <span>Organized by <strong>{organizer.displayName || organizer.email}</strong></span>
              </div>
            )}
          </div>

          {/* Action bar: join + RSVP */}
          {(event.conferenceLink || canRespond) && (
            <div className="event-detail__action-bar">
              {event.conferenceLink && (
                <Button
                  kind="primary"
                  size="sm"
                  renderIcon={Launch}
                  onClick={() => window.open(event.conferenceLink!, '_blank', 'noopener')}
                >
                  Join {getMeetingLabel(event.conferenceLink)}
                </Button>
              )}
              {canRespond && (
                <div className="event-detail__rsvp">
                  {selfAttendee && (
                    <Tag size="sm" type={RESPONSE_TAG[selfAttendee.responseStatus].color} renderIcon={RESPONSE_ICON[selfAttendee.responseStatus]}>
                      {RESPONSE_TAG[selfAttendee.responseStatus].label}
                    </Tag>
                  )}
                  <div className="event-detail__rsvp-actions">
                    <Button
                      kind={selfAttendee?.responseStatus === 'accepted' ? 'primary' : 'tertiary'}
                      size="sm"
                      renderIcon={Checkmark}
                      disabled={responding}
                      onClick={() => handleRespond('accepted')}
                    >
                      Yes
                    </Button>
                    <Button
                      kind={selfAttendee?.responseStatus === 'tentative' ? 'primary' : 'tertiary'}
                      size="sm"
                      renderIcon={Help}
                      disabled={responding}
                      onClick={() => handleRespond('tentative')}
                    >
                      Maybe
                    </Button>
                    <Button
                      kind={selfAttendee?.responseStatus === 'declined' ? 'danger' : 'danger--tertiary'}
                      size="sm"
                      renderIcon={Close}
                      disabled={responding}
                      onClick={() => handleRespond('declined')}
                    >
                      No
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Description */}
          {event.description && (
            <div className="event-detail__description">
              {renderDescription(event.description)}
            </div>
          )}

          {/* Attendees grouped by customer */}
          {attendeeGroups.length > 0 && (
            <div className="event-detail__attendees">
              <div className="event-detail__attendees-header">
                <UserMultiple size={16} />
                <span>{attendeesWithoutSelf.length} attendee{attendeesWithoutSelf.length !== 1 ? 's' : ''} · {attendeeGroups.length} organization{attendeeGroups.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="event-detail__attendees-grouped">
                {attendeeGroups.map((group) => {
                  const isExpanded = expandedGroups.has(group.key);
                  const toggleExpand = () => {
                    setExpandedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    });
                  };
                  return (
                    <div key={group.key} className="event-detail__group">
                      <div className="event-detail__group-header" onClick={toggleExpand}>
                        {group.logoUrl ? (
                          <img
                            src={group.logoUrl}
                            alt=""
                            className="customer-logo"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <Enterprise size={14} />
                        )}
                        <span className="event-detail__group-name">{group.label}</span>
                        {group.customerId && (
                          <Tag
                            size="sm"
                            type="teal"
                            className="event-detail__group-link"
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onClose(); navigate(`/customers/${group.customerId}`); }}
                          >
                            View
                          </Tag>
                        )}
                        <span className="event-detail__group-count">{group.attendees.length}</span>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>
                      {isExpanded && (
                        <div className="event-detail__group-members">
                          {group.attendees.map((attendee) => {
                            const tag = RESPONSE_TAG[attendee.responseStatus];
                            const StatusIcon = RESPONSE_ICON[attendee.responseStatus];
                            return (
                              <div key={attendee.email} className="event-detail__member">
                                <div className="event-detail__member-info">
                                  <span className="event-detail__member-name">
                                    {attendee.displayName || attendee.email.split('@')[0]}
                                    {attendee.organizer && (
                                      <Tag size="sm" type="purple" className="event-detail__organizer-tag">Organizer</Tag>
                                    )}
                                  </span>
                                  <span className="event-detail__member-email">{attendee.email}</span>
                                </div>
                                <Tag size="sm" type={tag.color} renderIcon={StatusIcon}>
                                  {tag.label}
                                </Tag>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer: synced label + actions */}
          <div className="event-detail__footer">
            {event.googleEventId && (
              <span className="event-detail__synced">Synced from Google Calendar</span>
            )}
            <div className="event-detail__actions">
              <Button
                kind="tertiary"
                size="sm"
                renderIcon={Edit}
                onClick={() => {
                  onClose();
                  onEdit(event);
                }}
              >
                Edit
              </Button>
              <Button
                kind="danger--tertiary"
                size="sm"
                renderIcon={TrashCan}
                onClick={() => { setDeleteMode('single'); setConfirmDelete(true); }}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      </SidePanel>

      {/* Delete confirmation modal (portalled to escape SidePanel z-index) */}
      {createPortal(<Modal
        open={confirmDelete}
        modalHeading="Delete event"
        danger
        size="sm"
        primaryButtonText="Delete"
        secondaryButtonText="Cancel"
        onRequestClose={() => { setConfirmDelete(false); setDeleteMode('single'); }}
        onRequestSubmit={() => {
          setConfirmDelete(false);
          onDelete(event, isRecurring ? deleteMode : 'single');
          setDeleteMode('single');
        }}
        onSecondarySubmit={() => { setConfirmDelete(false); setDeleteMode('single'); }}
      >
        <div className="event-detail__delete-confirm">
          {isRecurring ? (
            <>
              <p>This is a recurring event. What would you like to delete?</p>
              <RadioButtonGroup
                legendText=""
                name="delete-mode"
                valueSelected={deleteMode}
                onChange={(value: string) => setDeleteMode(value as 'single' | 'all')}
                orientation="vertical"
              >
                <RadioButton labelText="This event only" value="single" id="delete-single" />
                <RadioButton labelText="All events in series" value="all" id="delete-all" />
              </RadioButtonGroup>
            </>
          ) : (
            <p>Are you sure you want to delete &quot;{event.title}&quot;?</p>
          )}
        </div>
      </Modal>, document.body)}
    </>
  );
}
