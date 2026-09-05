import { useState } from 'react';
import { Button, ProgressBar, TextInput } from '@carbon/react';
import { Add } from '@carbon/icons-react';
import { format } from 'date-fns';
import { tasksApi } from '../../api/tasks';
import { useUIStore } from '../../store/uiStore';
import { useTaskStore } from '../../store/taskStore';
import { decodeEntities } from '../../utils/text';
import type { Task, TaskStatusConfig } from '../../types/task';

interface TaskSubtasksProps {
  task: Task;
  statuses: TaskStatusConfig[];
  /** Open another task in the panel — used to step into a subtask. */
  onOpenTask?: (id: string) => void;
  /** Re-read the parent after a write, so the list and counts are current. */
  onChanged: () => Promise<void> | void;
}

/**
 * The subtasks of a task, inside the edit panel.
 *
 * Every write here is immediate — it does not wait for the panel's Save.
 * A subtask is its own row, so "add" is a create and "done" is a status
 * change on another task; batching them behind the parent's Save would mean
 * a create that the user could then cancel, which is not a shape this app
 * has anywhere else.
 *
 * The checkbox moves a subtask between the account's first non-terminal
 * status and its first terminal one. With no terminal status defined there
 * is nothing "done" can mean, so the box is disabled and says why.
 */
export function TaskSubtasks({ task, statuses, onOpenTask, onChanged }: TaskSubtasksProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const subtasks = task.subtasks ?? [];
  const terminal = new Set(statuses.filter((s) => s.isTerminal).map((s) => s.name));
  const doneStatus = statuses.find((s) => s.isTerminal)?.name ?? null;
  const openStatus = statuses.find((s) => !s.isTerminal)?.name ?? statuses[0]?.name ?? 'TODO';
  const done = subtasks.filter((s) => terminal.has(s.status)).length;

  const add = async () => {
    const text = title.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await tasksApi.create({ title: text, parentId: task.id });
      setTitle('');
      taskChanged();
      await onChanged();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to add subtask' });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (sub: Task, nowDone: boolean) => {
    if (!doneStatus) return;
    try {
      await tasksApi.update(sub.id, { status: nowDone ? doneStatus : openStatus });
      taskChanged();
      await onChanged();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to update subtask' });
    }
  };

  return (
    <section className="task-section" aria-labelledby="task-subtasks-heading">
      <div className="task-section__header">
        <h4 id="task-subtasks-heading" className="task-section__title">Subtasks</h4>
        {subtasks.length > 0 && (
          <span className="task-section__count">{done} of {subtasks.length} done</span>
        )}
      </div>

      {subtasks.length > 0 && (
        <ProgressBar
          label="Subtasks done"
          hideLabel
          size="small"
          value={done}
          max={subtasks.length}
          status={done === subtasks.length ? 'finished' : 'active'}
          className="task-section__progress"
        />
      )}

      {subtasks.length > 0 && (
        <ul className="task-section__list">
          {subtasks.map((sub) => {
            const isDone = terminal.has(sub.status);
            const label = decodeEntities(sub.title);
            return (
              <li key={sub.id} className={`task-section__item${isDone ? ' task-section__item--done' : ''}`}>
                {/* Native input, per the Carbon Checkbox click gotcha in CLAUDE.md. */}
                <input
                  type="checkbox"
                  className="task-section__check"
                  checked={isDone}
                  disabled={!doneStatus}
                  title={doneStatus ? undefined : 'No status is marked as finished. Set one in Settings.'}
                  aria-label={`${isDone ? 'Reopen' : 'Mark done'}: ${label}`}
                  onChange={(e) => toggle(sub, e.target.checked)}
                />
                <button
                  type="button"
                  className="task-section__text task-section__text--link"
                  onClick={() => onOpenTask?.(sub.id)}
                  disabled={!onOpenTask}
                  title={onOpenTask ? `Open ${label}` : undefined}
                >
                  {label}
                </button>
                {sub.dueDate && (
                  <span className="task-section__meta">{format(new Date(sub.dueDate), 'MMM d')}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="task-section__add">
        <TextInput
          id="new-subtask-title"
          labelText="New subtask"
          hideLabel
          size="sm"
          placeholder="Add a subtask…"
          value={title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
        />
        <Button
          kind="ghost"
          size="sm"
          renderIcon={Add}
          hasIconOnly
          iconDescription="Add subtask"
          disabled={!title.trim() || busy}
          onClick={() => void add()}
        />
      </div>
    </section>
  );
}
