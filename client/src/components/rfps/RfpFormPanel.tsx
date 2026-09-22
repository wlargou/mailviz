import { useState, useEffect } from 'react';
import { Tearsheet, CreateTearsheet, CreateTearsheetStep } from '@carbon/ibm-products';
import { isAxiosError } from 'axios';
import { rfpsApi } from '../../api/rfps';
import { useUIStore } from '../../store/uiStore';
import { RfpDocuments, type PendingDocument } from './RfpDocuments';
import {
  EMPTY_RFP_FORM,
  RfpBudgetFields,
  RfpDeadlineFields,
  RfpIdentityFields,
  TIME_PATTERN,
  type RfpFormValues,
} from './RfpFormFields';
import type { Rfp } from '../../types/rfp';

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

/**
 * `CreateTearsheet` renders a `TearsheetShell` and spreads its extra props
 * onto it, so the date picker's calendar can still be named as a floating
 * menu — the prop is simply missing from the published types. Without it the
 * focus wrap swallows every click on the calendar.
 */
const FLOATING_MENUS = { selectorsFloatingMenus: ['.cds--date-picker__calendar'] } as Record<string, unknown>;

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
 * Creating runs through a four-step `CreateTearsheet` — tender, deadline,
 * budget, documents — which is the shape the register is growing into: the
 * questions deadline joins step two, the qualification thresholds join step
 * three, and the response checklist becomes a fifth.
 *
 * Editing stays a single `Tearsheet` with every field on one screen. Walking
 * four steps to move a status from Working to Submitted would be worse than
 * the form it replaced, and `EditTearsheet` — the multi-step edit
 * counterpart — is disabled by default in this version of
 * `@carbon/ibm-products` (`pkg.component.EditTearsheet === false`), so using
 * it would mean opting into an unreleased component.
 */
export function RfpFormPanel({ open, rfp, onClose, onSaved }: RfpFormPanelProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const [values, setValues] = useState<RfpFormValues>(EMPTY_RFP_FORM);
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [documents, setDocuments] = useState<Rfp['documents']>([]);
  const [saving, setSaving] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);

  const patch = (next: Partial<RfpFormValues>) => setValues((prev) => ({ ...prev, ...next }));

  // Seed when it opens, and only then: the table refetches in the background
  // and a new object identity for the same tender would otherwise wipe out
  // whatever had been typed.
  useEffect(() => {
    if (!open) return;
    setReferenceError(null);
    setPending([]);
    if (rfp) {
      setValues({
        name: rfp.name,
        reference: rfp.reference,
        customerId: rfp.customerId,
        status: rfp.status,
        deadlineDate: new Date(rfp.deadlineAt),
        deadlineTime: timeOf(rfp.deadlineAt),
        submissionFormat: rfp.submissionFormat,
        portalUrl: rfp.portalUrl ?? '',
        isGoe: rfp.isGoe,
        budget: rfp.budget === null ? '' : String(rfp.budget),
        notes: rfp.notes ?? '',
      });
      setDocuments(rfp.documents);
    } else {
      setValues(EMPTY_RFP_FORM);
      setDocuments([]);
    }
  }, [open, rfp]);

  const deadlineIso = toDeadlineIso(values.deadlineDate, values.deadlineTime);
  const identityDone = Boolean(values.name.trim() && values.reference.trim());
  const canSave = identityDone && Boolean(deadlineIso) && !saving;

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
      name: values.name.trim(),
      reference: values.reference.trim(),
      customerId: values.customerId,
      deadlineAt: deadlineIso,
      submissionFormat: values.submissionFormat,
      // Only meaningful for a portal submission; cleared otherwise so a
      // format change does not leave a stale link behind.
      portalUrl: values.submissionFormat === 'PORTAL' ? values.portalUrl.trim() || null : null,
      isGoe: values.isGoe,
      budget: values.isGoe && values.budget.trim() !== '' ? Number(values.budget) : null,
      status: values.status,
      notes: values.notes.trim() || null,
    };

    let id: string;
    try {
      id = rfp ? (await rfpsApi.update(rfp.id, body)).data.data.id : (await rfpsApi.create(body)).data.data.id;
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

  const groupProps = {
    values,
    patch,
    referenceError,
    onReferenceChange: () => setReferenceError(null),
  };

  const documentsSection = (idPrefix: string) => (
    <div className="rfp-form__field rfp-form__field--full">
      <RfpDocuments
        rfpId={rfp?.id}
        documents={documents}
        pending={pending}
        onPendingChange={setPending}
        onUploaded={() => rfp && refreshDocuments(rfp.id)}
      />
      <p className="rfp-form__section-hint" id={`${idPrefix}-documents-hint`}>
        The RC, the CPS, the Avis and any annexes. A tender's dossier is often
        several files, and one file is sometimes several documents.
      </p>
    </div>
  );

  // ── Editing: one screen, because changing a status is not a wizard ───────
  if (rfp) {
    return (
      <Tearsheet
        open={open}
        onClose={onClose}
        title="Edit RFP"
        label="RFPs"
        description={rfp.reference}
        hasCloseIcon
        selectorPrimaryFocus="#rfp-edit-name"
        selectorsFloatingMenus={['.cds--date-picker__calendar']}
        actions={[
          { label: 'Save', onClick: handleSubmit, kind: 'primary' as const, disabled: !canSave, loading: saving },
          { label: 'Cancel', onClick: onClose, kind: 'secondary' as const },
        ]}
      >
        <div className="rfp-form">
          <RfpIdentityFields {...groupProps} idPrefix="rfp-edit" />
          <RfpDeadlineFields {...groupProps} idPrefix="rfp-edit" />
          <RfpBudgetFields {...groupProps} idPrefix="rfp-edit" />
          <p className="rfp-form__section-label rfp-form__field--full">Documents</p>
          {documentsSection('rfp-edit')}
        </div>
      </Tearsheet>
    );
  }

  // ── Creating: the four steps the register is growing into ───────────────
  return (
    <CreateTearsheet
      {...FLOATING_MENUS}
      open={open}
      onClose={onClose}
      title="New RFP"
      label="RFPs"
      description="Register a tender and its dossier"
      selectorPrimaryFocus="#rfp-new-name"
      backButtonText="Back"
      cancelButtonText="Cancel"
      nextButtonText="Next"
      submitButtonText="Create RFP"
      onRequestSubmit={handleSubmit}
    >
      <CreateTearsheetStep
        title="Tender"
        subtitle="Who it is from and what it is called"
        hasFieldset={false}
        // Nothing downstream is meaningful without these two, and the
        // reference is what a duplicate is detected on. `disableSubmit` is
        // the whole gate — it disables this step's Next button. An `onNext`
        // that rejects would be belt and braces at the cost of an unhandled
        // rejection, since the wizard does not catch it.
        disableSubmit={!identityDone}
      >
        <div className="rfp-form">
          <RfpIdentityFields {...groupProps} idPrefix="rfp-new" />
        </div>
      </CreateTearsheetStep>

      <CreateTearsheetStep
        title="Deadline & submission"
        subtitle="When it is due, and how the offer is handed over"
        hasFieldset={false}
        disableSubmit={!deadlineIso}
      >
        <div className="rfp-form">
          <RfpDeadlineFields {...groupProps} idPrefix="rfp-new" />
        </div>
      </CreateTearsheetStep>

      <CreateTearsheetStep title="Budget" subtitle="What it is worth, if the buyer publishes it" hasFieldset={false}>
        <div className="rfp-form">
          <RfpBudgetFields {...groupProps} idPrefix="rfp-new" />
        </div>
      </CreateTearsheetStep>

      <CreateTearsheetStep
        title="Documents"
        subtitle="The dossier — added now or later"
        hasFieldset={false}
        disableSubmit={!canSave}
      >
        <div className="rfp-form">{documentsSection('rfp-new')}</div>
      </CreateTearsheetStep>
    </CreateTearsheet>
  );
}
