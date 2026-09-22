import { useState, useEffect } from 'react';
import {
  TextInput,
  TextArea,
  Dropdown,
  DatePicker,
  DatePickerInput,
  TimePicker,
  Toggle,
  NumberInput,
} from '@carbon/react';
import { Tearsheet } from '@carbon/ibm-products';
import { isAxiosError } from 'axios';
import { rfpsApi } from '../../api/rfps';
import { useUIStore } from '../../store/uiStore';
import { RfpDocuments, type PendingDocument } from './RfpDocuments';
import {
  RFP_STATUSES,
  RFP_STATUS_LABELS,
  RFP_SUBMISSION_FORMATS,
  RFP_SUBMISSION_FORMAT_LABELS,
  type Rfp,
  type RfpStatus,
  type RfpSubmissionFormat,
} from '../../types/rfp';

const statusItems = RFP_STATUSES.map((id) => ({ id, text: RFP_STATUS_LABELS[id] }));
const formatItems = RFP_SUBMISSION_FORMATS.map((id) => ({ id, text: RFP_SUBMISSION_FORMAT_LABELS[id] }));

/** `HH:mm`, the shape `TimePicker` produces and the only one we accept. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A day and a wall-clock time as an instant.
 *
 * The deadline is "09/09/2026 à 10H" in the buyer's own timezone, which for
 * every tender here is the browser's. `DatePicker` hands back local midnight,
 * so the hour is set on top of it and the instant follows from the browser.
 */
export function toDeadlineIso(date: Date | null, time: string): string | null {
  if (!date || !TIME_PATTERN.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface RfpFormPanelProps {
  open: boolean;
  /** Absent for a new tender; present to edit an existing one. */
  rfp?: Rfp | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Create or edit one tender.
 *
 * The wide `Tearsheet` per the container rubric: ten fields plus a document
 * list with uploads is the "complex or interactive" end of it, not the
 * medium one. It started as a `TearsheetNarrow`, where a single column left
 * the fields cramped — the document-type dropdown was narrow enough to
 * truncate "Complément" to "Co…" — while the rest of the screen went unused.
 *
 * The body is a two-column grid: the short identity fields pair up, and the
 * things that need room (the name, the portal URL, the notes, the dossier)
 * span both. The date picker appends its calendar to `<body>`, so it is
 * named as a floating menu or the focus wrap swallows the clicks on it.
 */
export function RfpFormPanel({ open, rfp, onClose, onSaved }: RfpFormPanelProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [deadlineDate, setDeadlineDate] = useState<Date | null>(null);
  const [deadlineTime, setDeadlineTime] = useState('10:00');
  const [submissionFormat, setSubmissionFormat] = useState<RfpSubmissionFormat>('PORTAL');
  const [portalUrl, setPortalUrl] = useState('');
  const [isGoe, setIsGoe] = useState(false);
  const [budget, setBudget] = useState('');
  const [status, setStatus] = useState<RfpStatus>('OPEN');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [documents, setDocuments] = useState<Rfp['documents']>([]);
  const [saving, setSaving] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);

  // Seed when it opens, and only then: the table refetches in the background
  // and a new object identity for the same tender would otherwise wipe out
  // whatever had been typed.
  useEffect(() => {
    if (!open) return;
    setReferenceError(null);
    setPending([]);
    if (rfp) {
      setName(rfp.name);
      setReference(rfp.reference);
      setDeadlineDate(new Date(rfp.deadlineAt));
      setDeadlineTime(timeOf(rfp.deadlineAt));
      setSubmissionFormat(rfp.submissionFormat);
      setPortalUrl(rfp.portalUrl ?? '');
      setIsGoe(rfp.isGoe);
      setBudget(rfp.budget === null ? '' : String(rfp.budget));
      setStatus(rfp.status);
      setNotes(rfp.notes ?? '');
      setDocuments(rfp.documents);
    } else {
      setName('');
      setReference('');
      setDeadlineDate(null);
      setDeadlineTime('10:00');
      setSubmissionFormat('PORTAL');
      setPortalUrl('');
      setIsGoe(false);
      setBudget('');
      setStatus('OPEN');
      setNotes('');
      setDocuments([]);
    }
  }, [open, rfp]);

  const deadlineIso = toDeadlineIso(deadlineDate, deadlineTime);
  const canSave = Boolean(name.trim() && reference.trim() && deadlineIso) && !saving;

  const refreshDocuments = async (id: string) => {
    try {
      const { data: res } = await rfpsApi.getById(id);
      setDocuments(res.data.documents);
      onSaved();
    } catch {
      /* the panel still holds what it had */
    }
  };

  const handleSubmit = async () => {
    if (!canSave || !deadlineIso) return;
    setSaving(true);
    setReferenceError(null);
    const body = {
      name: name.trim(),
      reference: reference.trim(),
      deadlineAt: deadlineIso,
      submissionFormat,
      // Only meaningful for a portal submission; cleared otherwise so a
      // format change does not leave a stale link behind.
      portalUrl: submissionFormat === 'PORTAL' ? portalUrl.trim() || null : null,
      isGoe,
      budget: isGoe && budget.trim() !== '' ? Number(budget) : null,
      status,
      notes: notes.trim() || null,
    };
    let id: string;
    try {
      id = rfp
        ? (await rfpsApi.update(rfp.id, body)).data.data.id
        : (await rfpsApi.create(body)).data.data.id;
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409) {
        setReferenceError('An RFP with this reference already exists');
      } else {
        addNotification({ kind: 'error', title: rfp ? 'Failed to update the RFP' : 'Failed to create the RFP' });
      }
      setSaving(false);
      return;
    }

    // Files chosen before the tender existed go up now that it does.
    //
    // Deliberately outside the try above. The tender is saved by this point,
    // so a failing upload must not be reported as a failed save and must not
    // hold the panel open — that told the user nothing had happened while the
    // row was already in the table.
    const failed: string[] = [];
    for (const p of pending) {
      try {
        await rfpsApi.uploadDocument(id, p.file, p.kind);
      } catch {
        failed.push(p.file.name);
      }
    }

    if (failed.length > 0) {
      addNotification({
        kind: 'warning',
        title: `RFP saved, but ${failed.length} document${failed.length === 1 ? '' : 's'} did not upload`,
        subtitle: failed.join(', '),
      });
    } else {
      addNotification({ kind: 'success', title: rfp ? 'RFP updated' : 'RFP created', subtitle: body.reference });
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Tearsheet
      open={open}
      onClose={onClose}
      title={rfp ? 'Edit RFP' : 'New RFP'}
      label="RFPs"
      description={rfp ? rfp.reference : 'Register a tender and its dossier'}
      hasCloseIcon
      selectorPrimaryFocus="#rfp-name"
      selectorsFloatingMenus={['.cds--date-picker__calendar']}
      actions={[
        { label: rfp ? 'Save' : 'Create', onClick: handleSubmit, kind: 'primary' as const, disabled: !canSave, loading: saving },
        { label: 'Cancel', onClick: onClose, kind: 'secondary' as const },
      ]}
    >
      <div className="rfp-form">
        <TextInput
          id="rfp-name"
          labelText="RFP name"
          placeholder="Refonte de la plateforme matérielle AIX"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          className="rfp-form__field rfp-form__field--full"
        />
        <TextInput
          id="rfp-reference"
          labelText="Reference"
          placeholder="70/AOO/BKAM/2026"
          value={reference}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setReference(e.target.value);
            setReferenceError(null);
          }}
          invalid={Boolean(referenceError)}
          invalidText={referenceError ?? ''}
          className="rfp-form__field"
        />

        <div className="rfp-form__field rfp-form__row">
          <DatePicker
            datePickerType="single"
            value={deadlineDate ? [deadlineDate] : []}
            onChange={(dates: Date[]) => setDeadlineDate(dates[0] ?? null)}
          >
            <DatePickerInput id="rfp-deadline-date" labelText="Submission deadline" placeholder="mm/dd/yyyy" />
          </DatePicker>
          <TimePicker
            id="rfp-deadline-time"
            labelText="Time"
            value={deadlineTime}
            invalid={!TIME_PATTERN.test(deadlineTime)}
            invalidText="Use HH:MM"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDeadlineTime(e.target.value)}
          />
        </div>

        <Dropdown
          id="rfp-format"
          titleText="Submission format"
          label="Select format"
          items={formatItems}
          itemToString={(item) => item?.text || ''}
          selectedItem={formatItems.find((f) => f.id === submissionFormat) ?? null}
          onChange={({ selectedItem }) => {
            if (selectedItem) setSubmissionFormat(selectedItem.id);
          }}
          className="rfp-form__field"
        />
        {submissionFormat === 'PORTAL' && (
          <TextInput
            id="rfp-portal-url"
            labelText="Portal"
            // Every buyer runs its own, so the format alone does not say where
            // the offer goes.
            placeholder="https://portailachats.bankalmaghrib.ma/"
            helperText="The buyer's own portal — each one is different"
            value={portalUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPortalUrl(e.target.value)}
            className="rfp-form__field rfp-form__field--full"
          />
        )}

        <div className="rfp-form__field">
          <Toggle
            id="rfp-goe"
            labelText="Government-Owned Entity"
            labelA="No"
            labelB="Yes"
            toggled={isGoe}
            onToggle={(checked: boolean) => setIsGoe(checked)}
          />
        </div>
        {isGoe && (
          <div className="rfp-form__field">
            <NumberInput
              id="rfp-budget"
              label="Budget (MAD)"
              helperText="The published estimate — carried by the Avis, not the RC or the CPS"
              min={0}
              step={1000}
              value={budget === '' ? '' : Number(budget)}
              hideSteppers
              onChange={(_e: unknown, state: { value: string | number }) => setBudget(String(state.value ?? ''))}
            />
          </div>
        )}

        <Dropdown
          id="rfp-status"
          titleText="Status"
          label="Select status"
          items={statusItems}
          itemToString={(item) => item?.text || ''}
          selectedItem={statusItems.find((s) => s.id === status) ?? null}
          onChange={({ selectedItem }) => {
            if (selectedItem) setStatus(selectedItem.id);
          }}
          className="rfp-form__field"
        />

        <TextArea
          id="rfp-notes"
          labelText="Notes"
          placeholder="Lot unique · cautionnement provisoire 630 000 DH · référence ≥ 10 M DH exigée"
          value={notes}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
          className="rfp-form__field rfp-form__field--full"
        />

        <div className="rfp-form__field">
          <p className="rfp-form__section-label">Documents</p>
          <RfpDocuments
            rfpId={rfp?.id}
            documents={documents}
            pending={pending}
            onPendingChange={setPending}
            onUploaded={() => rfp && refreshDocuments(rfp.id)}
          />
        </div>
      </div>
    </Tearsheet>
  );
}
