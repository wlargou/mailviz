import { TextInput, TextArea, Dropdown, DatePicker, DatePickerInput, TimePicker, Toggle, NumberInput } from '@carbon/react';
import { CompanyComboBox } from '../shared/CompanyComboBox';
import {
  RFP_STATUSES,
  RFP_STATUS_LABELS,
  RFP_SUBMISSION_FORMATS,
  RFP_SUBMISSION_FORMAT_LABELS,
  type RfpStatus,
  type RfpSubmissionFormat,
} from '../../types/rfp';

/**
 * The tender form's fields, in the four groups the wizard steps through.
 *
 * They live here rather than in the panel because there are two ways into
 * them: a multi-step `CreateTearsheet` for a new tender, and a single
 * `Tearsheet` for editing one — where a four-step wizard to change a status
 * from Working to Submitted would be worse than the form it replaced. One
 * definition of each field, so the two cannot drift.
 */
export interface RfpFormValues {
  name: string;
  reference: string;
  customerId: string | null;
  status: RfpStatus;
  deadlineDate: Date | null;
  deadlineTime: string;
  submissionFormat: RfpSubmissionFormat;
  portalUrl: string;
  isGoe: boolean;
  budget: string;
  notes: string;
}

export const EMPTY_RFP_FORM: RfpFormValues = {
  name: '',
  reference: '',
  customerId: null,
  status: 'OPEN',
  deadlineDate: null,
  deadlineTime: '10:00',
  submissionFormat: 'PORTAL',
  portalUrl: '',
  isGoe: false,
  budget: '',
  notes: '',
};

/** `HH:mm`, the shape `TimePicker` produces and the only one we accept. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const statusItems = RFP_STATUSES.map((id) => ({ id, text: RFP_STATUS_LABELS[id] }));
const formatItems = RFP_SUBMISSION_FORMATS.map((id) => ({ id, text: RFP_SUBMISSION_FORMAT_LABELS[id] }));

interface GroupProps {
  values: RfpFormValues;
  patch: (values: Partial<RfpFormValues>) => void;
  /** Distinguishes the create and edit instances, which can both be mounted. */
  idPrefix: string;
  referenceError?: string | null;
  onReferenceChange?: () => void;
}

/** Who the tender is from, what it is called, and where it stands. */
export function RfpIdentityFields({ values, patch, idPrefix, referenceError, onReferenceChange }: GroupProps) {
  return (
    <>
      <TextInput
        id={`${idPrefix}-name`}
        labelText="RFP name"
        placeholder="Refonte de la plateforme matérielle AIX"
        value={values.name}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch({ name: e.target.value })}
        className="rfp-form__field rfp-form__field--full"
      />
      <TextInput
        id={`${idPrefix}-reference`}
        labelText="Reference"
        placeholder="70/AOO/BKAM/2026"
        helperText="The buyer's own numbering — unique within your account"
        value={values.reference}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          patch({ reference: e.target.value });
          onReferenceChange?.();
        }}
        invalid={Boolean(referenceError)}
        invalidText={referenceError ?? ''}
        className="rfp-form__field"
      />
      <div className="rfp-form__field">
        {/* The buying organisation, from the CRM's companies. Optional: a
            tender can be registered before its buyer is. */}
        <CompanyComboBox
          id={`${idPrefix}-customer`}
          titleText="Company"
          placeholder="Bank Al-Maghrib"
          selectedId={values.customerId}
          onChange={(customerId) => patch({ customerId })}
          allowNone
        />
      </div>
      <Dropdown
        id={`${idPrefix}-status`}
        titleText="Status"
        label="Select status"
        items={statusItems}
        itemToString={(item) => item?.text || ''}
        selectedItem={statusItems.find((s) => s.id === values.status) ?? null}
        onChange={({ selectedItem }) => {
          if (selectedItem) patch({ status: selectedItem.id });
        }}
        className="rfp-form__field"
      />
    </>
  );
}

/** When it is due, and how the offer is handed over. */
export function RfpDeadlineFields({ values, patch, idPrefix }: GroupProps) {
  return (
    <>
      <div className="rfp-form__field rfp-form__row">
        <DatePicker
          datePickerType="single"
          value={values.deadlineDate ? [values.deadlineDate] : []}
          onChange={(dates: Date[]) => patch({ deadlineDate: dates[0] ?? null })}
        >
          <DatePickerInput id={`${idPrefix}-deadline-date`} labelText="Submission deadline" placeholder="mm/dd/yyyy" />
        </DatePicker>
        <TimePicker
          id={`${idPrefix}-deadline-time`}
          labelText="Time"
          value={values.deadlineTime}
          invalid={!TIME_PATTERN.test(values.deadlineTime)}
          invalidText="Use HH:MM"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch({ deadlineTime: e.target.value })}
        />
      </div>
      <Dropdown
        id={`${idPrefix}-format`}
        titleText="Submission format"
        label="Select format"
        items={formatItems}
        itemToString={(item) => item?.text || ''}
        selectedItem={formatItems.find((f) => f.id === values.submissionFormat) ?? null}
        onChange={({ selectedItem }) => {
          if (selectedItem) patch({ submissionFormat: selectedItem.id });
        }}
        className="rfp-form__field"
      />
      {values.submissionFormat === 'PORTAL' && (
        <TextInput
          id={`${idPrefix}-portal-url`}
          labelText="Portal"
          placeholder="https://portailachats.bankalmaghrib.ma/"
          helperText="The buyer's own portal — each one is different"
          value={values.portalUrl}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch({ portalUrl: e.target.value })}
          className="rfp-form__field rfp-form__field--full"
        />
      )}
    </>
  );
}

/** What it is worth, and anything else worth remembering. */
export function RfpBudgetFields({ values, patch, idPrefix }: GroupProps) {
  return (
    <>
      <div className="rfp-form__field">
        <Toggle
          id={`${idPrefix}-goe`}
          labelText="Government-Owned Entity"
          labelA="No"
          labelB="Yes"
          toggled={values.isGoe}
          onToggle={(checked: boolean) => patch({ isGoe: checked })}
        />
      </div>
      {values.isGoe && (
        <div className="rfp-form__field">
          <NumberInput
            id={`${idPrefix}-budget`}
            label="Budget (MAD)"
            helperText="The published estimate — carried by the Avis, not the RC or the CPS"
            min={0}
            step={1000}
            value={values.budget === '' ? '' : Number(values.budget)}
            hideSteppers
            onChange={(_e: unknown, state: { value: string | number }) => patch({ budget: String(state.value ?? '') })}
          />
        </div>
      )}
      <TextArea
        id={`${idPrefix}-notes`}
        labelText="Notes"
        placeholder="Lot unique · cautionnement provisoire 630 000 DH · référence ≥ 10 M DH exigée"
        value={values.notes}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => patch({ notes: e.target.value })}
        className="rfp-form__field rfp-form__field--full"
      />
    </>
  );
}
