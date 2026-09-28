import { TextInput, TextArea, Dropdown, DatePicker, DatePickerInput, TimePicker, Toggle, Button, Checkbox } from '@carbon/react';
import { Add, TrashCan } from '@carbon/icons-react';
import { CompanyComboBox } from '../shared/CompanyComboBox';
import {
  RFP_STATUSES,
  RFP_STATUS_LABELS,
  RFP_SUBMISSION_FORMATS,
  RFP_SUBMISSION_FORMAT_LABELS,
  formatBudget,
  parseBudget,
  type RfpCatalogueEntry,
  type RfpFolderKind,
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
  /** When questions to the buyer close — day and hour, like the deadline. */
  questionsDate: Date | null;
  questionsTime: string;
  /** The Avis date, where the at-risk clock starts. */
  publishedDate: Date | null;
  submissionFormat: RfpSubmissionFormat;
  portalUrl: string;
  isGoe: boolean;
  notes: string;
  /** Budgets as typed; converted once, when the payload is built. */
  lots: Array<{ title: string; budget: string }>;
  /** The dossiers to prepare. The offers are made once per lot. */
  compositionKinds: RfpFolderKind[];
  /** Fill each dossier with the pieces the RCs require. */
  prefill: boolean;
}

export const EMPTY_RFP_FORM: RfpFormValues = {
  name: '',
  reference: '',
  customerId: null,
  status: 'OPEN',
  deadlineDate: null,
  deadlineTime: '10:00',
  questionsDate: null,
  questionsTime: '10:00',
  publishedDate: null,
  submissionFormat: 'PORTAL',
  portalUrl: '',
  isGoe: false,
  notes: '',
  lots: [{ title: 'Lot unique', budget: '' }],
  // The four every sample tender asked for; the dossier additif only some.
  compositionKinds: ['ADMINISTRATIF', 'TECHNIQUE', 'OFFRE_TECHNIQUE', 'OFFRE_FINANCIERE'],
  prefill: true,
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
      <TextArea
        id={`${idPrefix}-notes`}
        labelText="Notes"
        placeholder="Cautionnement provisoire 630 000 DH · référence ≥ 10 M DH exigée"
        value={values.notes}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => patch({ notes: e.target.value })}
        className="rfp-form__field rfp-form__field--full"
      />
    </>
  );
}

/** When it is due, and how the offer is handed over. */
/** Questions must close on or before the submission deadline. */
export function questionsAfterDeadline(v: Pick<RfpFormValues, 'questionsDate' | 'deadlineDate'>): boolean {
  return Boolean(v.questionsDate && v.deadlineDate && v.questionsDate.getTime() > v.deadlineDate.getTime());
}

/** Nor can a tender be published after it closes. */
export function publishedAfterDeadline(v: Pick<RfpFormValues, 'publishedDate' | 'deadlineDate'>): boolean {
  return Boolean(v.publishedDate && v.deadlineDate && v.publishedDate.getTime() > v.deadlineDate.getTime());
}

export function RfpDeadlineFields({ values, patch, idPrefix }: GroupProps) {
  return (
    <>
      <div className="rfp-form__field rfp-form__row">
        <DatePicker
          datePickerType="single"
          value={values.deadlineDate ? [values.deadlineDate] : []}
          onChange={(dates: Date[]) => {
            const deadline = dates[0] ?? null;
            // Public tenders close questions seven days before the opening.
            // Filled in the first time a deadline is picked, and only then:
            // a date the user set or cleared is theirs.
            const firstDeadline = deadline && !values.deadlineDate && !values.questionsDate;
            patch({
              deadlineDate: deadline,
              ...(firstDeadline ? { questionsDate: new Date(deadline.getTime() - 7 * 86_400_000) } : {}),
            });
          }}
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
      <div className="rfp-form__field rfp-form__row">
        <DatePicker
          datePickerType="single"
          value={values.questionsDate ? [values.questionsDate] : []}
          onChange={(dates: Date[]) => patch({ questionsDate: dates[0] ?? null })}
        >
          <DatePickerInput
            id={`${idPrefix}-questions-date`}
            labelText="Questions close"
            placeholder="mm/dd/yyyy"
            helperText="Usually 7 days before, for a public tender"
            invalid={questionsAfterDeadline(values)}
            invalidText="Must be before the deadline"
          />
        </DatePicker>
        <TimePicker
          id={`${idPrefix}-questions-time`}
          labelText="Closing time"
          value={values.questionsTime}
          invalid={Boolean(values.questionsDate) && !TIME_PATTERN.test(values.questionsTime)}
          invalidText="Use HH:MM"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch({ questionsTime: e.target.value })}
        />
      </div>
      <DatePicker
        datePickerType="single"
        className="rfp-form__field"
        value={values.publishedDate ? [values.publishedDate] : []}
        onChange={(dates: Date[]) => patch({ publishedDate: dates[0] ?? null })}
      >
        <DatePickerInput
          id={`${idPrefix}-published-date`}
          labelText="Published on (optional)"
          placeholder="mm/dd/yyyy"
          helperText="The Avis date — readiness is measured from here"
          invalid={publishedAfterDeadline(values)}
          invalidText="Must be before the deadline"
        />
      </DatePicker>
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

/**
 * An amount in dirhams, kept as typed and read by `parseBudget`.
 *
 * A `TextInput`, not Carbon's `NumberInput`. The latter keeps its own copy of
 * a controlled value and syncs it from the prop one render late, so between
 * two quick keystrokes the field is reset to the previous number and a digit
 * is lost — typing 1500000 left 1000. It also refuses "1 500 000,00", which
 * is how the Avis prints the figure people paste.
 */
export function BudgetInput({
  id,
  labelText,
  hideLabel,
  helperText,
  value,
  onChange,
}: {
  id: string;
  labelText: string;
  hideLabel?: boolean;
  helperText?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextInput
      id={id}
      labelText={labelText}
      hideLabel={hideLabel}
      helperText={helperText}
      placeholder="1 500 000"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      invalid={parseBudget(value) === undefined}
      invalidText="Not an amount — e.g. 1 500 000"
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}

/**
 * Whether the buyer is a Government-Owned Entity — which is what makes a
 * budget public at all, and so what decides whether budgets are asked for.
 */
export function RfpGoeField({ values, patch, idPrefix }: GroupProps) {
  return (
    <div className="rfp-form__field rfp-form__field--full">
      <Toggle
        id={`${idPrefix}-goe`}
        labelText="Government-Owned Entity"
        labelA="No"
        labelB="Yes"
        toggled={values.isGoe}
        onToggle={(checked: boolean) => patch({ isGoe: checked })}
      />
    </div>
  );
}

/**
 * The lots, each with its own budget.
 *
 * "Lot unique" is the common case — every sample tender was one — so a new
 * tender starts with exactly that and the list only grows if the RC splits
 * the work. Budgets are asked for only for a public buyer; the tender's
 * total is theirs summed, on the server.
 */
export function RfpLotsEditor({ values, patch, idPrefix }: GroupProps) {
  const setLot = (index: number, next: Partial<{ title: string; budget: string }>) =>
    patch({ lots: values.lots.map((lot, i) => (i === index ? { ...lot, ...next } : lot)) });

  const addLot = () => {
    // A tender that turns out to be allotted: "Lot unique" stops being true.
    const renamed = values.lots.length === 1 && values.lots[0].title === 'Lot unique' ? [{ ...values.lots[0], title: 'Lot 1' }] : values.lots;
    patch({ lots: [...renamed, { title: `Lot ${renamed.length + 1}`, budget: '' }] });
  };

  const total = values.lots.reduce((sum, l) => sum + (parseBudget(l.budget) ?? 0), 0);

  return (
    <div className="rfp-form__field rfp-form__field--full rfp-lots-editor">
      <p className="rfp-form__section-label">Lots</p>
      {values.lots.map((lot, i) => (
        <div key={i} className={`rfp-lots-editor__row${values.isGoe ? ' rfp-lots-editor__row--budget' : ''}`}>
          <span className="rfp-lots-editor__number">{i + 1}</span>
          <TextInput
            id={`${idPrefix}-lot-${i}-title`}
            labelText={`Lot ${i + 1} title`}
            hideLabel
            placeholder="Lot unique"
            value={lot.title}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLot(i, { title: e.target.value })}
            invalid={!lot.title.trim()}
            invalidText="A lot needs a title"
          />
          {values.isGoe && (
            <BudgetInput
              id={`${idPrefix}-lot-${i}-budget`}
              labelText={`Lot ${i + 1} budget (MAD)`}
              hideLabel
              value={lot.budget}
              onChange={(budget) => setLot(i, { budget })}
            />
          )}
          <Button
            kind="ghost"
            size="md"
            hasIconOnly
            renderIcon={TrashCan}
            iconDescription={`Remove lot ${i + 1}`}
            // A tender keeps at least one lot.
            disabled={values.lots.length <= 1}
            onClick={() => patch({ lots: values.lots.filter((_, j) => j !== i) })}
          />
        </div>
      ))}
      <Button kind="ghost" size="sm" renderIcon={Add} onClick={addLot}>
        Add lot
      </Button>
      {values.isGoe && (
        <p className="rfp-form__section-hint">
          {total > 0 && <strong className="rfp-lots-editor__total">Total {formatBudget(total)} · </strong>}
          Each lot&apos;s published estimate — carried by the Avis, not the RC or the CPS. The tender&apos;s budget is their total.
        </p>
      )}
    </div>
  );
}

/**
 * Which dossiers the response needs.
 *
 * What gets prepared is decided here, on creation, because it is what the
 * detail page tracks from then on. Each choice shows the pieces it starts
 * with — they come from the server's catalogue, which is built from the
 * RCs themselves — and the offers say they are per lot.
 */
export function RfpCompositionFields({
  values,
  patch,
  idPrefix,
  catalogue,
}: GroupProps & { catalogue: RfpCatalogueEntry[] }) {
  const toggle = (kind: RfpFolderKind, checked: boolean) =>
    patch({ compositionKinds: checked ? [...values.compositionKinds, kind] : values.compositionKinds.filter((k) => k !== kind) });

  // "Autre" is for the one-off the RC invents; it is added from the page.
  const offered = catalogue.filter((c) => c.kind !== 'OTHER');
  const lotCount = values.lots.length;

  return (
    <div className="rfp-form__field rfp-form__field--full">
      <fieldset className="cds--fieldset rfp-composition">
        <legend className="cds--label">Dossiers to prepare</legend>
        {offered.map((entry) => (
          <div key={entry.kind} className="rfp-composition__option">
            <Checkbox
              id={`${idPrefix}-kind-${entry.kind}`}
              labelText={
                entry.perLot && lotCount > 1 ? `${entry.label} — one per lot (${lotCount})` : entry.label
              }
              checked={values.compositionKinds.includes(entry.kind)}
              onChange={(_e: React.ChangeEvent<HTMLInputElement>, { checked }: { checked: boolean }) => toggle(entry.kind, checked)}
            />
            {values.prefill && entry.defaultItems.length > 0 && (
              <p className="rfp-composition__pieces">{entry.defaultItems.join(' · ')}</p>
            )}
          </div>
        ))}
      </fieldset>
      <Toggle
        id={`${idPrefix}-prefill`}
        labelText="Start each dossier with the standard pieces"
        labelA="Empty"
        labelB="Pre-filled"
        toggled={values.prefill}
        onToggle={(checked: boolean) => patch({ prefill: checked })}
      />
    </div>
  );
}
