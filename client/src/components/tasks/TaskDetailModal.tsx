import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TextInput,
  TextArea,
  Dropdown,
  DatePicker,
  DatePickerInput,
  MultiSelect,
  InlineNotification,
  ActionableNotification,
  SkeletonText,
  Button,
  Slider,
} from '@carbon/react';
import { SidePanel } from '@carbon/ibm-products';
import { Save, Share } from '@carbon/icons-react';
import type { AxiosError } from 'axios';
import { tasksApi } from '../../api/tasks';
import { taskStatusesApi } from '../../api/taskStatuses';
import { authApi } from '../../api/auth';
import { ShareDialog } from '../shared/ShareDialog';
import { CompanyComboBox } from '../shared/CompanyComboBox';
import { TaskSubtasks } from './TaskSubtasks';
import { TaskChecklist } from './TaskChecklist';
import { TaskActivity } from './TaskActivity';
import { TaskDependencies } from './TaskDependencies';
import { TaskLinks } from './TaskLinks';
import { TaskTime } from './TaskTime';
import { TaskEmails } from './TaskEmails';
import { emailsApi } from '../../api/emails';
import { SaveAsTemplateModal } from './SaveAsTemplateModal';
import { TemplateIcon } from './TemplateIcon';
import { apiError } from '../../utils/apiError';
import { buildRecurrenceOptions, buildRecurrenceRules, parseRecurrencePreset, type RecurrencePresetId } from '../../utils/recurrence';
import { format } from 'date-fns';
import { REMINDER_OPTIONS, reminderFor, reminderPreset, type ReminderPresetId } from '../../utils/reminders';
import { TaskParentCrumb } from './TaskProgressTags';
import { useUIStore } from '../../store/uiStore';
import type { Task, Label, TaskPriority, TaskStatus, TaskStatusConfig } from '../../types/task';
import { decodeEntities } from '../../utils/text';
import { useTaskStore } from '../../store/taskStore';

const priorityItems = [
  { id: 'LOW', text: 'Low' },
  { id: 'MEDIUM', text: 'Medium' },
  { id: 'HIGH', text: 'High' },
  { id: 'URGENT', text: 'Urgent' },
];

// Discrete effort values in minutes
const EFFORT_STEPS = [0, 5, 10, 15, 30, 60, 120, 240, 480];
const EFFORT_LABELS: Record<number, string> = {
  0: 'None', 5: '5 min', 10: '10 min', 15: '15 min',
  30: '30 min', 60: '1 hour', 120: '2 hours', 240: '4 hours', 480: '1 day',
};

function minutesToStepIndex(minutes: number | null): number {
  if (!minutes) return 0;
  const idx = EFFORT_STEPS.indexOf(minutes);
  return idx >= 0 ? idx : 0;
}

function stepIndexToMinutes(index: number): number | null {
  const val = EFFORT_STEPS[index] ?? 0;
  return val === 0 ? null : val;
}

/**
 * Same labels, regardless of order.
 *
 * Selection order drifts as chips are toggled off and on, so an order-sensitive
 * compare would call an unchanged set dirty. That is not merely wasteful:
 * sending `labelIds` reaches a delete-then-recreate rewrite on the server, so a
 * false positive here clobbers a label change made anywhere else.
 */
export function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(b);
  return a.every((id) => seen.has(id));
}

interface LabelItem {
  id: string;
  text: string;
}

interface TaskDetailModalProps {
  taskId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
  /**
   * Swap the panel to another task — a subtask, or the parent. The panel is
   * keyed on `taskId`, so the caller changes that and this component refetches.
   * Optional: a host that cannot navigate (the dashboard) just gets no links.
   */
  onOpenTask?: (taskId: string) => void;
  labels: Label[];
}

export function TaskDetailModal({ taskId, open, onClose, onUpdated, onOpenTask, labels }: TaskDetailModalProps) {
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [task, setTask] = useState<Task | null>(null);
  /**
   * The payload this panel WOULD send for the values it was seeded with.
   *
   * Diffing against this rather than against the fetched task is what makes
   * "untouched" mean untouched. The form does not hold the server's values: it
   * holds them decoded, trimmed, and snapped to the effort ladder. Comparing a
   * transformed form value against an untransformed row reports every
   * entity-bearing title and every off-ladder estimate as edited — precisely
   * the rows that then get rewritten. Applying the same transforms to both
   * sides makes an untouched field identical by construction.
   */
  const baselineRef = useRef<Record<string, unknown> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('TODO');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  /** `locked` holds a reminder time set outside the presets, shown as is. */
  const [reminder, setReminder] = useState<ReminderPresetId>('none');
  const [lockedReminder, setLockedReminder] = useState<string | null>(null);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [assignedToId, setAssignedToId] = useState<string | null>(null);
  const [effortIndex, setEffortIndex] = useState(0);
  /**
   * The repeat preset, anchored on the due date. `locked` holds a rule the
   * presets cannot express (set through the API), shown read-only rather
   * than flattened by a save that never touched it.
   */
  const [recurrencePreset, setRecurrencePreset] = useState<RecurrencePresetId>('none');
  const [lockedRecurrence, setLockedRecurrence] = useState<string | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; name: string | null; email: string }>>([]);
  const [statusItems, setStatusItems] = useState<{ id: string; text: string }[]>([]);
  // The full rows too: the subtask checkboxes need to know which are terminal.
  const [statusConfigs, setStatusConfigs] = useState<TaskStatusConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  /**
   * The server refused to finish this task because a blocker is open. Kept
   * so the panel can offer "Complete anyway", which resends with `force`.
   */
  const [blockedBy, setBlockedBy] = useState<{ message: string; blockers: Array<{ id: string; title: string }> } | null>(null);
  const [taskShares, setTaskShares] = useState<any[]>([]);
  const addNotification = useUIStore((s) => s.addNotification);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const notifyRef = useRef(addNotification);
  notifyRef.current = addNotification;
  const changedRef = useRef(taskChanged);
  changedRef.current = taskChanged;

  const fetchStatuses = useCallback(async () => {
    try {
      const { data: res } = await taskStatusesApi.getAll();
      setStatusConfigs(res.data);
      setStatusItems(res.data.map((s: TaskStatusConfig) => ({ id: s.name, text: s.label })));
    } catch { /* ignore */ }
  }, []);

  /**
   * Re-read the task WITHOUT re-seeding the form.
   *
   * The subtask and checklist sections write immediately, and afterwards the
   * panel needs the new rows and counts — but not a reset of the fields the
   * user may be mid-edit in. The loading effect below clears everything and
   * seeds again, which is right for opening a task and wrong here.
   */
  const [sectionVersion, setSectionVersion] = useState(0);
  const reloadTask = useCallback(async () => {
    if (!taskId) return;
    try {
      const { data: res } = await tasksApi.getById(taskId);
      setTask((current) => (current && current.id === res.data.id ? res.data : current));
      setSectionVersion((v) => v + 1);
    } catch { /* the sections keep what they have; the next open reloads */ }
  }, [taskId]);

  const fetchUsers = useCallback(async () => {
    try {
      const { data: res } = await authApi.getUsers();
      setUsers(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) {
      fetchStatuses();
      fetchUsers();
    }
  }, [open, fetchStatuses, fetchUsers]);

  /**
   * The panel fetches the task it was asked for, rather than being handed one.
   *
   * It used to take a whole `Task` captured when the row was clicked, which was
   * wrong in three separate ways:
   *
   *  - **It went stale.** The views refresh in the background now, but the
   *    captured object did not, so reopening a task could re-seed old values —
   *    and this form PATCHes every field, so saving wrote them back over
   *    whatever had changed.
   *  - **It was the wrong shape from two of three views.** `findAll` does not
   *    include `mailToTask`, so the "Created from email" block only ever
   *    appeared for tasks opened from By Company. `findById` includes it, so it
   *    now renders wherever the task was opened from.
   *  - **It mounted the label field before the labels were known.** Carbon's
   *    `MultiSelect` here is uncontrolled — it takes `initialSelectedItems`,
   *    which `Selection` reads once into `useState` and never syncs again. The
   *    subtree mounted on the render where `task` became non-null, one render
   *    BEFORE the seeding effect ran, so the field showed the *previous* task's
   *    chips: the first task opened showed none whatever its labels, and every
   *    task after that showed its predecessor's. Touching the field then wrote
   *    that wrong set back on save.
   *
   * Seeding inside the fetch is what fixes the third one: these `setState`
   * calls batch with `setTask`, so the form — and the MultiSelect — mount in
   * the same commit that already holds the right values.
   */
  useEffect(() => {
    if (!open || !taskId) {
      setTask(null);
      setLoadFailed(false);
      baselineRef.current = null;
      return;
    }

    let cancelled = false;
    setTask(null);
    setLoadFailed(false);
    baselineRef.current = null;

    void (async () => {
      try {
        const { data: res } = await tasksApi.getById(taskId);
        if (cancelled) return;
        const fresh = res.data;

        setTitle(decodeEntities(fresh.title));
        setDescription(decodeEntities(fresh.description));
        setStatus(fresh.status);
        setPriority(fresh.priority);
        setDueDate(fresh.dueDate);
        setStartDate(fresh.startDate);
        const reminderId = reminderPreset(fresh.remindAt, fresh.dueDate ? new Date(fresh.dueDate) : null);
        setReminder(reminderId ?? 'none');
        setLockedReminder(reminderId === null ? fresh.remindAt : null);
        setSelectedLabels(fresh.labels.map((l) => l.id));
        setCustomerId(fresh.customerId);
        setAssignedToId(fresh.assignedToId || null);
        setEffortIndex(minutesToStepIndex(fresh.estimatedMinutes));
        const anchor = fresh.dueDate ? new Date(fresh.dueDate) : new Date();
        const preset = parseRecurrencePreset(fresh.recurrence ? [fresh.recurrence] : [], anchor);
        setRecurrencePreset(preset ?? 'none');
        setLockedRecurrence(preset === null ? fresh.recurrence : null);
        baselineRef.current = {
          recurrence: fresh.recurrence ?? null,
          startDate: fresh.startDate,
          remindAt: fresh.remindAt,
          title: decodeEntities(fresh.title).trim(),
          description: decodeEntities(fresh.description).trim(),
          status: fresh.status,
          priority: fresh.priority,
          dueDate: fresh.dueDate,
          labelIds: fresh.labels.map((l) => l.id),
          customerId: fresh.customerId,
          // Round-tripped through the ladder, so an estimate the slider cannot
          // represent — 45 minutes, set by an API caller — is not reported as
          // an edit and silently deleted by a save that never touched it.
          estimatedMinutes: stepIndexToMinutes(minutesToStepIndex(fresh.estimatedMinutes)),
        };
        setTask(fresh);
      } catch (err) {
        if (cancelled) return;
        // Deleted in another tab or another view. Say so, drop the ghost row
        // from every list, and close — rather than leaving a form open over a
        // task that no longer exists.
        if ((err as AxiosError).response?.status === 404) {
          notifyRef.current({ kind: 'error', title: 'This task no longer exists' });
          changedRef.current();
          closeRef.current();
          return;
        }
        setLoadFailed(true);
      }
    })();

    // A slow open landing after the user has already opened something else
    // must not overwrite it.
    return () => { cancelled = true; };
  }, [open, taskId, retry]);

  /**
   * Closing a task that came from mail usually means the thread is done too.
   * Offer, do not act: the thread may still be live for someone else's ask.
   */
  const offerToArchive = (newStatus: string | undefined) => {
    if (!task || !newStatus) return;
    const finished = statusConfigs.some((s) => s.name === newStatus && s.isTerminal);
    const inInbox = (task.emailLinks ?? []).filter((l) => !l.email.isArchived);
    if (!finished || inInbox.length === 0) return;
    addNotification({
      kind: 'info',
      title: `Archive the ${inInbox.length === 1 ? 'linked email' : `${inInbox.length} linked emails`}?`,
      subtitle: inInbox.length === 1 ? decodeEntities(inInbox[0]!.email.subject) : 'The threads this task was made from.',
      action: {
        label: 'Archive',
        onClick: () => {
          void emailsApi.batchArchive(inInbox.map((l) => l.email.id)).catch(() => {
            addNotification({ kind: 'error', title: 'Could not archive the emails' });
          });
        },
      },
    });
  };

  const handleSubmit = async (force = false) => {
    if (!task || !title.trim()) return;
    setLoading(true);
    setBlockedBy(null);
    try {
      // Assignment deliberately does NOT go through the generic update. Only
      // PATCH /tasks/:id/assign creates the notification and emits the
      // `task:assigned` WebSocket event, so routing it through `update` meant
      // the assignee was never told.
      const assignmentChanged = (task.assignedToId ?? null) !== assignedToId;

      // Send what changed, not the whole form.
      //
      // Writing all eight fields back meant a user who edited only the title
      // also rewrote status, due date, labels, company and estimate from
      // whatever the form happened to hold — reverting anything changed
      // elsewhere in between, and deleting an estimate the slider could not
      // represent. It also made the audit log's `changes` list, which is just
      // the payload's keys, say "everything" on every save.
      const base = baselineRef.current;
      if (!base) return;

      const patch: Record<string, unknown> = {};
      const nextTitle = title.trim();
      // Not `|| undefined`: JSON.stringify drops an undefined value, so
      // emptying the box sent no key at all and clearing a description was a
      // silent no-op. The column is nullable but the validator is not, so ''
      // is how it clears.
      const nextDescription = description.trim();
      const nextEstimate = stepIndexToMinutes(effortIndex);

      if (nextTitle !== base.title) patch.title = nextTitle;
      if (nextDescription !== base.description) patch.description = nextDescription;
      if (status !== base.status) patch.status = status;
      if (priority !== base.priority) patch.priority = priority;
      if (dueDate !== base.dueDate) patch.dueDate = dueDate;
      if (startDate !== base.startDate) patch.startDate = startDate;
      if (!lockedReminder) {
        const nextRemindAt = reminderFor(reminder, dueDate ? new Date(dueDate) : null)?.toISOString() ?? null;
        if (nextRemindAt !== base.remindAt) patch.remindAt = nextRemindAt;
      }
      if (customerId !== base.customerId) patch.customerId = customerId;
      if (nextEstimate !== base.estimatedMinutes) patch.estimatedMinutes = nextEstimate;
      // A locked rule is never rewritten; a preset is re-derived from the
      // due date on every save, so moving the date moves the weekday with it.
      if (!lockedRecurrence) {
        const nextRecurrence = dueDate ? buildRecurrenceRules(recurrencePreset, new Date(dueDate))[0] ?? null : null;
        if (nextRecurrence !== base.recurrence) patch.recurrence = nextRecurrence;
      }
      if (!sameIdSet(selectedLabels, (base.labelIds as string[]) ?? [])) {
        patch.labelIds = selectedLabels;
      }

      // An empty PATCH is a no-op the server would still audit as a change.
      if (Object.keys(patch).length > 0) {
        await tasksApi.update(task.id, force ? { ...patch, force: true } : patch);
      }

      if (assignmentChanged) {
        await tasksApi.assignTask(task.id, assignedToId);
      }

      addNotification({ kind: 'success', title: 'Task updated' });
      offerToArchive(patch.status as string | undefined);
      taskChanged();
      onUpdated();
      onClose();
    } catch (err) {
      const refusal = apiError(err);
      if (refusal.status === 409 && refusal.code === 'TASK_BLOCKED') {
        // Not a failure: a rule, with a way past it. Shown in the panel,
        // where the decision is made, rather than as a toast that vanishes.
        const details = refusal.details as { blockers?: Array<{ id: string; title: string }> } | undefined;
        setBlockedBy({ message: refusal.message ?? 'This task is blocked', blockers: details?.blockers ?? [] });
        return;
      }
      addNotification({ kind: 'error', title: 'Failed to update task' });
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <SidePanel
      open={open}
      onRequestClose={onClose}
      title="Edit Task"
      size="md"
      className="task-detail-panel"
      actions={[
        {
          label: loading ? 'Saving...' : 'Save',
          onClick: () => void handleSubmit(),
          kind: 'primary' as const,
          // Stable footer while the task loads — a Save that appears late
          // moves everything under the cursor.
          disabled: !task || !title.trim() || loading,
          icon: Save,
        },
      ]}
    >
      {!task && !loadFailed && (
        <div className="modal-form">
          <SkeletonText paragraph lineCount={7} />
        </div>
      )}

      {loadFailed && (
        <div className="modal-form">
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title="Could not load this task"
            subtitle="Showing nothing rather than something stale."
          />
          <Button kind="tertiary" size="sm" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}

      {task && (
      <div className="modal-form">
        {blockedBy && (
          <ActionableNotification
            inline
            lowContrast
            kind="warning"
            className="task-section__notice"
            title="Still blocked"
            subtitle={blockedBy.message}
            actionButtonLabel="Complete anyway"
            onActionButtonClick={() => void handleSubmit(true)}
            onClose={() => { setBlockedBy(null); return false; }}
          />
        )}
        {task.parent && (
          <div className="task-detail-panel__crumb">
            <TaskParentCrumb
              parent={{ ...task.parent, title: decodeEntities(task.parent.title) }}
              onOpen={onOpenTask}
            />
          </div>
        )}
        <TextInput
          id="edit-task-title"
          labelText="Title"
          value={title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          required
        />
        <TextArea
          id="edit-task-description"
          labelText="Description"
          value={description}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
        />
        <div className="modal-form__row">
          <div style={{ flex: 1 }}>
            <Dropdown
              id="edit-task-status"
              titleText="Status"
              label="Select status"
              items={statusItems}
              itemToString={(item) => item?.text || ''}
              selectedItem={statusItems.find((s) => s.id === status)}
              onChange={({ selectedItem }) => {
                if (selectedItem) setStatus(selectedItem.id as TaskStatus);
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Dropdown
              id="edit-task-priority"
              titleText="Priority"
              label="Select priority"
              items={priorityItems}
              itemToString={(item) => item?.text || ''}
              selectedItem={priorityItems.find((p) => p.id === priority)}
              onChange={({ selectedItem }) => {
                if (selectedItem) setPriority(selectedItem.id as TaskPriority);
              }}
            />
          </div>
        </div>
        <DatePicker
          datePickerType="single"
          value={dueDate ? new Date(dueDate) : undefined}
          onChange={([date]: Date[]) => {
            setDueDate(date ? date.toISOString() : null);
          }}
        >
          <DatePickerInput
            id="edit-task-due-date"
            labelText="Due Date"
            placeholder="mm/dd/yyyy"
          />
        </DatePicker>
        <div className="modal-form__row">
          <div style={{ flex: 1 }}>
            <DatePicker
              datePickerType="single"
              value={startDate ? new Date(startDate) : undefined}
              onChange={([date]: Date[]) => {
                setStartDate(date ? date.toISOString() : null);
              }}
            >
              <DatePickerInput id="edit-task-start-date" labelText="Start Date" placeholder="mm/dd/yyyy" />
            </DatePicker>
          </div>
          <div style={{ flex: 1 }}>
            {lockedReminder ? (
              <TextInput id="edit-task-reminder-locked" labelText="Reminder" value={format(new Date(lockedReminder), 'PPp')} readOnly helperText="Set outside the presets; shown as is." />
            ) : (
              <Dropdown
                id="edit-task-reminder"
                titleText="Reminder"
                label="No reminder"
                helperText={dueDate ? undefined : 'Set a due date first'}
                disabled={!dueDate}
                items={REMINDER_OPTIONS}
                itemToString={(item) => item?.label || ''}
                selectedItem={REMINDER_OPTIONS.find((o) => o.id === (dueDate ? reminder : 'none'))}
                onChange={({ selectedItem }) => {
                  if (selectedItem) setReminder(selectedItem.id);
                }}
              />
            )}
          </div>
        </div>
        {lockedRecurrence ? (
          <TextInput id="edit-task-recurrence-locked" labelText="Repeat" value={lockedRecurrence} readOnly helperText="Set outside the presets; shown as is." />
        ) : (
          <Dropdown
            id="edit-task-recurrence"
            titleText="Repeat"
            label="Does not repeat"
            helperText={dueDate ? undefined : 'Set a due date to repeat from'}
            disabled={!dueDate}
            items={buildRecurrenceOptions(dueDate ? new Date(dueDate) : new Date())}
            itemToString={(item) => item?.label || ''}
            selectedItem={buildRecurrenceOptions(dueDate ? new Date(dueDate) : new Date()).find((o) => o.id === (dueDate ? recurrencePreset : 'none'))}
            onChange={({ selectedItem }) => {
              if (selectedItem) setRecurrencePreset(selectedItem.id);
            }}
          />
        )}
        {(task.recurrencePrevious || task.recurrenceNext) && (
          <p className="modal-form__helper task-occurrences">
            {task.recurrencePrevious && (
              <>
                Previous occurrence:{' '}
                <button type="button" className="task-parent-crumb--link task-occurrences__link" onClick={() => onOpenTask?.(task.recurrencePrevious!.id)} disabled={!onOpenTask}>
                  {task.recurrencePrevious.dueDate ? format(new Date(task.recurrencePrevious.dueDate), 'MMM d, yyyy') : 'undated'}
                </button>
              </>
            )}
            {task.recurrencePrevious && task.recurrenceNext && ' · '}
            {task.recurrenceNext && (
              <>
                Next occurrence:{' '}
                <button type="button" className="task-parent-crumb--link task-occurrences__link" onClick={() => onOpenTask?.(task.recurrenceNext!.id)} disabled={!onOpenTask}>
                  {task.recurrenceNext.dueDate ? format(new Date(task.recurrenceNext.dueDate), 'MMM d, yyyy') : 'undated'}
                </button>
              </>
            )}
          </p>
        )}
        <CompanyComboBox
          id="edit-task-customer"
          titleText="Company"
          selectedId={customerId}
          onChange={(id) => setCustomerId(id)}
          allowNone
        />
        <Dropdown
          id="edit-task-assigned"
          titleText="Assigned to"
          label="Unassigned"
          items={[{ id: '', text: 'Unassigned' }, ...users.map((u) => ({ id: u.id, text: u.name || u.email }))]}
          itemToString={(item: any) => item?.text || ''}
          selectedItem={assignedToId ? { id: assignedToId, text: users.find((u) => u.id === assignedToId)?.name || users.find((u) => u.id === assignedToId)?.email || '' } : { id: '', text: 'Unassigned' }}
          onChange={({ selectedItem }: any) => {
            setAssignedToId(selectedItem?.id || null);
          }}
        />
        <div className="modal-form__effort">
          <Slider
            id="edit-task-effort"
            labelText={`Estimated effort: ${EFFORT_LABELS[EFFORT_STEPS[effortIndex]] || 'None'}`}
            min={0}
            max={EFFORT_STEPS.length - 1}
            step={1}
            value={effortIndex}
            onChange={({ value }: { value: number }) => setEffortIndex(value)}
            hideTextInput
          />
        </div>
        <MultiSelect
          id="edit-task-labels"
          titleText="Labels"
          disabled={labels.length === 0}
          helperText={labels.length === 0 ? 'No labels available. Add some in Settings.' : undefined}
          label="Select labels"
          items={labels.map((l) => ({ id: l.id, text: l.name }))}
          itemToString={(item: LabelItem | null) => item?.text || ''}
          initialSelectedItems={labels
            .filter((l) => selectedLabels.includes(l.id))
            .map((l) => ({ id: l.id, text: l.name }))}
          onChange={({ selectedItems }: { selectedItems: LabelItem[] }) => {
            setSelectedLabels(selectedItems.map((item: LabelItem) => item.id));
          }}
        />
        {/* A subtask cannot have subtasks (two levels), so its panel has no
            section for them — the crumb above is its whole hierarchy. */}
        {!task.parentId && (
          <TaskSubtasks task={task} statuses={statusConfigs} onOpenTask={onOpenTask} onChanged={reloadTask} />
        )}
        <TaskChecklist taskId={task.id} items={task.checklist ?? []} onChanged={reloadTask} />
        <TaskDependencies task={task} statuses={statusConfigs} onOpenTask={onOpenTask} onChanged={reloadTask} />
        <TaskLinks task={task} onChanged={reloadTask} />
        <TaskTime task={task} onChanged={reloadTask} />
        <TaskActivity taskId={task.id} ownerId={task.userId} users={users} statuses={statusConfigs} version={sectionVersion} />
        <TaskEmails task={task} onChanged={reloadTask} />
        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--cds-border-subtle)' }}>
          <Button
            kind="tertiary"
            size="sm"
            renderIcon={Share}
            onClick={async () => {
              if (!task) return;
              try {
                const { data: res } = await tasksApi.getTaskShares(task.id);
                setTaskShares(res.data);
              } catch { setTaskShares([]); }
              setShareOpen(true);
            }}
          >
            Share task
          </Button>
          <Button kind="tertiary" size="sm" renderIcon={TemplateIcon} onClick={() => setSaveTemplateOpen(true)} style={{ marginLeft: '0.5rem' }}>
            Save as template
          </Button>
        </div>
      </div>
      )}

      {/* Mounted only while open: Carbon's Modal renders its fields hidden
          otherwise, and a hidden input seeded with the title is a second
          "Renew the contract" for anything reading the form by value. */}
      {task && saveTemplateOpen && (
        <SaveAsTemplateModal
          open={saveTemplateOpen}
          taskId={task.id}
          suggestedName={decodeEntities(task.title)}
          onClose={() => setSaveTemplateOpen(false)}
        />
      )}

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={decodeEntities(task?.title)}
        currentShares={taskShares}
        onShare={async (userIds) => {
          if (!task) return;
          await tasksApi.shareTask(task.id, userIds);
          taskChanged();
          addNotification({ kind: 'success', title: 'Task shared' });
        }}
        onUnshare={async (userId) => {
          if (!task) return;
          await tasksApi.unshareTask(task.id, userId);
          taskChanged();
          addNotification({ kind: 'success', title: 'Share removed' });
        }}
        onRefresh={async () => {
          if (!task) return;
          try {
            const { data: res } = await tasksApi.getTaskShares(task.id);
            setTaskShares(res.data);
          } catch { setTaskShares([]); }
        }}
      />
    </SidePanel>
  );
}
