import { Dropdown, DatePicker, DatePickerInput, MultiSelect, Slider, TextArea } from '@carbon/react';
import { CompanyComboBox } from '../shared/CompanyComboBox';
import type { CreateTaskInput, Label, TaskPriority, TaskStatus } from '../../types/task';
import { buildRecurrenceOptions, buildRecurrenceRules, type RecurrencePresetId } from '../../utils/recurrence';
import { REMINDER_OPTIONS, reminderFor, type ReminderPresetId } from '../../utils/reminders';
import { EFFORT_STEPS, effortLabel, stepIndexToMinutes } from '../../utils/effort';

/**
 * The body of a "new task" form, minus the title.
 *
 * Two places create a task from nothing: the Tasks page and the
 * convert-an-email flow in Mail. They used to be two forms, and the second
 * silently fell behind — no due date, no labels, no estimate — every time
 * the first gained a field. This is the one set of fields, with the values
 * held by the caller (it owns submit and reset) and the payload shape built
 * by `taskFormToInput` so both send exactly the same thing.
 *
 * The title stays with the caller: the convert flow seeds it from the email
 * and labels it differently, and it is the only field that gates submit.
 */
export interface TaskFormValues {
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  startDate: string | null;
  reminder: ReminderPresetId;
  recurrencePreset: RecurrencePresetId;
  customerId: string | null;
  labelIds: string[];
  /** Index into `EFFORT_STEPS`, not minutes — the slider's own unit. */
  effortIndex: number;
}

export const EMPTY_TASK_FORM: TaskFormValues = {
  description: '',
  status: 'TODO',
  priority: 'MEDIUM',
  dueDate: null,
  startDate: null,
  reminder: 'none',
  recurrencePreset: 'none',
  customerId: null,
  labelIds: [],
  effortIndex: 0,
};

/**
 * The request body for these values. Reminder and repeat are relative to the
 * due date and are dropped without one, matching what the fields show — a
 * disabled "Repeat" must not send a rule the server would refuse.
 */
export function taskFormToInput(v: TaskFormValues): Omit<CreateTaskInput, 'title'> {
  const due = v.dueDate ? new Date(v.dueDate) : null;
  return {
    description: v.description.trim() || undefined,
    status: v.status,
    priority: v.priority,
    dueDate: v.dueDate,
    startDate: v.startDate ?? undefined,
    labelIds: v.labelIds.length > 0 ? v.labelIds : undefined,
    customerId: v.customerId,
    recurrence: due ? buildRecurrenceRules(v.recurrencePreset, due)[0] ?? undefined : undefined,
    remindAt: reminderFor(v.reminder, due)?.toISOString() ?? undefined,
    estimatedMinutes: stepIndexToMinutes(v.effortIndex),
  };
}

export interface StatusItem {
  id: string;
  text: string;
  isTerminal?: boolean;
}

/**
 * The status a new task starts in. Statuses are the user's own rows, so
 * there is no name to hard-code — `'TODO'` matched nothing for a user whose
 * first column is `TO_DO`, and the dropdown sat on its placeholder. The
 * first non-terminal status in the user's order, falling back to the first.
 */
export function defaultStatus(items: StatusItem[], current: TaskStatus): TaskStatus {
  if (items.some((s) => s.id === current)) return current;
  return (items.find((s) => !s.isTerminal) ?? items[0])?.id ?? current;
}

export function toStatusItems(rows: { name: string; label: string; isTerminal?: boolean }[]): StatusItem[] {
  return rows.map((s) => ({ id: s.name, text: s.label, isTerminal: s.isTerminal }));
}

const priorityItems: { id: TaskPriority; text: string }[] = [
  { id: 'LOW', text: 'Low' },
  { id: 'MEDIUM', text: 'Medium' },
  { id: 'HIGH', text: 'High' },
  { id: 'URGENT', text: 'Urgent' },
];

interface LabelItem {
  id: string;
  text: string;
}

interface TaskFormFieldsProps {
  /** Prefix for every field id, so two forms on one page never collide. */
  idPrefix: string;
  /**
   * Per-item spacing class. A SidePanel supplies its own gutters
   * (`create-side-panel__form-item`); a Tearsheet hands the body full width
   * and the items carry theirs (`tearsheet-form__item`).
   */
  itemClassName: string;
  values: TaskFormValues;
  onChange: (patch: Partial<TaskFormValues>) => void;
  statusItems: StatusItem[];
  labels: Label[];
}

export function TaskFormFields({ idPrefix, itemClassName, values, onChange, statusItems, labels }: TaskFormFieldsProps) {
  const { description, status, priority, dueDate, startDate, reminder, recurrencePreset, customerId, labelIds, effortIndex } = values;
  const recurrenceOptions = buildRecurrenceOptions(dueDate ? new Date(dueDate) : new Date());
  const labelItems: LabelItem[] = labels.map((l) => ({ id: l.id, text: l.name }));

  return (
    <>
      <TextArea
        id={`${idPrefix}-description`}
        labelText="Description"
        placeholder="Enter task description (optional)"
        value={description}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange({ description: e.target.value })}
        className={itemClassName}
      />
      <Dropdown
        id={`${idPrefix}-status`}
        titleText="Status"
        label="Select status"
        items={statusItems}
        itemToString={(item) => item?.text || ''}
        selectedItem={statusItems.find((s) => s.id === status) ?? null}
        onChange={({ selectedItem }) => {
          if (selectedItem) onChange({ status: selectedItem.id });
        }}
        className={itemClassName}
      />
      <Dropdown
        id={`${idPrefix}-priority`}
        titleText="Priority"
        label="Select priority"
        items={priorityItems}
        itemToString={(item) => item?.text || ''}
        selectedItem={priorityItems.find((p) => p.id === priority) ?? null}
        onChange={({ selectedItem }) => {
          if (selectedItem) onChange({ priority: selectedItem.id });
        }}
        className={itemClassName}
      />
      {/* The class goes on a wrapper, not on DatePickerInput: Carbon puts
          it on the inner input container, so a gutter class would inset the
          input and leave the label flush against the panel edge. */}
      <div className={itemClassName}>
        <DatePicker
          datePickerType="single"
          value={dueDate ? new Date(dueDate) : undefined}
          onChange={([date]: Date[]) => onChange({ dueDate: date ? date.toISOString() : null })}
        >
          <DatePickerInput id={`${idPrefix}-due-date`} labelText="Due Date" placeholder="mm/dd/yyyy" />
        </DatePicker>
      </div>
      <div className={itemClassName}>
        <DatePicker
          datePickerType="single"
          value={startDate ? new Date(startDate) : undefined}
          onChange={([date]: Date[]) => onChange({ startDate: date ? date.toISOString() : null })}
        >
          <DatePickerInput id={`${idPrefix}-start-date`} labelText="Start Date" placeholder="mm/dd/yyyy" />
        </DatePicker>
      </div>
      <Dropdown
        id={`${idPrefix}-reminder`}
        titleText="Reminder"
        label="No reminder"
        helperText={dueDate ? undefined : 'Set a due date first'}
        disabled={!dueDate}
        items={REMINDER_OPTIONS}
        itemToString={(item) => item?.label || ''}
        selectedItem={REMINDER_OPTIONS.find((o) => o.id === (dueDate ? reminder : 'none')) ?? null}
        onChange={({ selectedItem }) => {
          if (selectedItem) onChange({ reminder: selectedItem.id });
        }}
        className={itemClassName}
      />
      <Dropdown
        id={`${idPrefix}-recurrence`}
        titleText="Repeat"
        label="Does not repeat"
        helperText={dueDate ? undefined : 'Set a due date to repeat from'}
        disabled={!dueDate}
        items={recurrenceOptions}
        itemToString={(item) => item?.label || ''}
        selectedItem={recurrenceOptions.find((o) => o.id === (dueDate ? recurrencePreset : 'none')) ?? null}
        onChange={({ selectedItem }) => {
          if (selectedItem) onChange({ recurrencePreset: selectedItem.id });
        }}
        className={itemClassName}
      />
      <div className={itemClassName}>
        <CompanyComboBox
          id={`${idPrefix}-customer`}
          titleText="Company"
          selectedId={customerId}
          onChange={(id) => onChange({ customerId: id })}
          allowNone
        />
      </div>
      <MultiSelect
        id={`${idPrefix}-labels`}
        titleText="Labels"
        disabled={labels.length === 0}
        helperText={labels.length === 0 ? 'No labels available. Add some in Settings.' : undefined}
        label="Select labels"
        items={labelItems}
        itemToString={(item: LabelItem | null) => item?.text || ''}
        selectedItems={labelItems.filter((item) => labelIds.includes(item.id))}
        onChange={({ selectedItems }: { selectedItems: LabelItem[] }) => {
          onChange({ labelIds: selectedItems.map((item) => item.id) });
        }}
        className={itemClassName}
      />
      <div className={itemClassName}>
        <Slider
          id={`${idPrefix}-effort`}
          labelText={`Estimated effort: ${effortLabel(effortIndex)}`}
          min={0}
          max={EFFORT_STEPS.length - 1}
          step={1}
          value={effortIndex}
          onChange={({ value }: { value: number }) => onChange({ effortIndex: value })}
          formatLabel={(value: number) => effortLabel(value)}
          hideTextInput
        />
      </div>
    </>
  );
}
