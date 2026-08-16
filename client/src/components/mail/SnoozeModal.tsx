import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  ContentSwitcher,
  Switch,
  RadioButtonGroup,
  RadioButton,
  DatePicker,
  DatePickerInput,
  TimePicker,
} from '@carbon/react';
import { addDays, addHours, format, nextMonday, startOfHour } from 'date-fns';
import type { ReminderKind } from '../../types/email';

/**
 * Pick a time to be reminded about a thread.
 *
 * Two decisions worth stating:
 *
 * **Presets first, raw date/time last.** Nobody snoozing mail wants to fill in
 * a datetime field; they want "tomorrow morning". Each preset renders the
 * absolute time it resolves to, so the shortcut never hides what it means, and
 * "Pick a date and time" is there for the case the presets do not cover.
 *
 * **One modal for both kinds.** Snooze and follow-up answer different questions
 * about the same thread at the same moment ("not now" vs "chase this"), and
 * splitting them into two row actions would put two nearly identical clock
 * icons next to each other. The switcher makes the difference explicit, and the
 * explanatory line under it is the only place the app can say what a follow-up
 * actually does.
 *
 * Carbon rubric (CLAUDE.md): a couple of fields → `Modal` at `sm`, not a
 * SidePanel. This is rendered from MailPage's top level, not from inside the
 * SidePanel, so it needs no portal.
 */

interface Preset {
  id: string;
  label: string;
  at: (now: Date) => Date;
}

const AT_MORNING = 8;
const AT_EVENING = 18;

function atHour(day: Date, hour: number): Date {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const SNOOZE_PRESETS: Preset[] = [
  { id: 'later', label: 'Later today', at: (now) => startOfHour(addHours(now, 3)) },
  { id: 'tomorrow', label: 'Tomorrow morning', at: (now) => atHour(addDays(now, 1), AT_MORNING) },
  { id: 'tomorrow-pm', label: 'Tomorrow evening', at: (now) => atHour(addDays(now, 1), AT_EVENING) },
  { id: 'next-week', label: 'Next week', at: (now) => atHour(nextMonday(now), AT_MORNING) },
];

const FOLLOW_UP_PRESETS: Preset[] = [
  { id: 'tomorrow', label: 'Tomorrow morning', at: (now) => atHour(addDays(now, 1), AT_MORNING) },
  { id: 'two-days', label: 'In two days', at: (now) => atHour(addDays(now, 2), AT_MORNING) },
  { id: 'next-week', label: 'Next week', at: (now) => atHour(nextMonday(now), AT_MORNING) },
  { id: 'two-weeks', label: 'In two weeks', at: (now) => atHour(addDays(now, 14), AT_MORNING) },
];

const CUSTOM = 'custom';

const KINDS: ReminderKind[] = ['snooze', 'follow_up'];

interface SnoozeModalProps {
  open: boolean;
  subject: string;
  /** Which tab to land on. The row's snooze button opens on 'snooze'. */
  initialKind?: ReminderKind;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (kind: ReminderKind, remindAt: Date) => void;
}

export function SnoozeModal({
  open,
  subject,
  initialKind = 'snooze',
  saving = false,
  onClose,
  onSubmit,
}: SnoozeModalProps) {
  const [kind, setKind] = useState<ReminderKind>(initialKind);
  const [presetId, setPresetId] = useState<string>(SNOOZE_PRESETS[0].id);
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const [customTime, setCustomTime] = useState('09:00');
  const [error, setError] = useState<string | null>(null);

  // Reopening on a different thread must not inherit the last thread's answer.
  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setPresetId((initialKind === 'snooze' ? SNOOZE_PRESETS : FOLLOW_UP_PRESETS)[0].id);
    setCustomDate(null);
    setCustomTime('09:00');
    setError(null);
  }, [open, initialKind]);

  const presets = kind === 'snooze' ? SNOOZE_PRESETS : FOLLOW_UP_PRESETS;

  // Resolved once per render so the labels and the value submitted come from
  // the same clock reading.
  const resolved = useMemo(() => {
    const now = new Date();
    return presets.map((p) => ({ ...p, when: p.at(now) }));
  }, [presets]);

  const selectKind = (next: ReminderKind) => {
    setKind(next);
    setPresetId((next === 'snooze' ? SNOOZE_PRESETS : FOLLOW_UP_PRESETS)[0].id);
    setError(null);
  };

  const remindAt = (): Date | null => {
    if (presetId !== CUSTOM) {
      return resolved.find((p) => p.id === presetId)?.when ?? null;
    }
    if (!customDate) return null;
    const [hours, minutes] = customTime.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    const at = new Date(customDate);
    at.setHours(hours, minutes, 0, 0);
    return at;
  };

  const submit = () => {
    const at = remindAt();
    if (!at) {
      setError('Choose a date and a time');
      return;
    }
    if (at.getTime() <= Date.now()) {
      setError('Pick a time in the future');
      return;
    }
    onSubmit(kind, at);
  };

  return (
    <Modal
      open={open}
      size="sm"
      modalHeading={kind === 'snooze' ? 'Snooze this thread' : 'Remind me to follow up'}
      modalLabel={subject || '(No subject)'}
      primaryButtonText={saving ? 'Saving…' : kind === 'snooze' ? 'Snooze' : 'Set reminder'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={saving}
      onRequestClose={onClose}
      onRequestSubmit={submit}
    >
      <div className="snooze-form">
        <ContentSwitcher
          size="sm"
          selectedIndex={KINDS.indexOf(kind)}
          onChange={({ index }) => {
            if (index === undefined) return;
            selectKind(KINDS[index]);
          }}
        >
          <Switch name="snooze" text="Snooze" />
          <Switch name="follow_up" text="Follow up" />
        </ContentSwitcher>

        <p className="snooze-form__explainer">
          {kind === 'snooze'
            ? 'The thread leaves your inbox now and comes back, unread, at the time you pick.'
            : 'Nothing moves. You get a reminder at the time you pick — unless somebody replies first, in which case it cancels itself.'}
        </p>

        <RadioButtonGroup
          legendText={kind === 'snooze' ? 'Bring it back' : 'Remind me'}
          name="snooze-when"
          orientation="vertical"
          valueSelected={presetId}
          onChange={(value) => {
            setPresetId(String(value));
            setError(null);
          }}
        >
          {resolved.map((preset) => (
            <RadioButton
              key={preset.id}
              id={`snooze-preset-${preset.id}`}
              value={preset.id}
              labelText={
                <span className="snooze-preset">
                  <span className="snooze-preset__label">{preset.label}</span>
                  <span className="snooze-preset__when">
                    {format(preset.when, 'EEE d MMM, h:mm a')}
                  </span>
                </span>
              }
            />
          ))}
          <RadioButton
            id="snooze-preset-custom"
            value={CUSTOM}
            labelText={<span className="snooze-preset__label">Pick a date and time</span>}
          />
        </RadioButtonGroup>

        {presetId === CUSTOM && (
          <div className="snooze-form__custom">
            <DatePicker
              datePickerType="single"
              value={customDate ? [customDate] : []}
              minDate={new Date().toISOString()}
              onChange={(dates: Date[]) => {
                setCustomDate(dates[0] || null);
                setError(null);
              }}
            >
              <DatePickerInput id="snooze-date" labelText="Date" placeholder="mm/dd/yyyy" size="sm" />
            </DatePicker>
            <TimePicker
              id="snooze-time"
              labelText="Time"
              value={customTime}
              size="sm"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setCustomTime(e.target.value);
                setError(null);
              }}
            />
          </div>
        )}

        {error && <p className="snooze-form__error">{error}</p>}
      </div>
    </Modal>
  );
}
