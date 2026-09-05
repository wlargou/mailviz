import { useState } from 'react';
import { Button, ProgressBar, TextInput } from '@carbon/react';
import { Add, TrashCan } from '@carbon/icons-react';
import { tasksApi } from '../../api/tasks';
import { useUIStore } from '../../store/uiStore';
import { useTaskStore } from '../../store/taskStore';
import type { ChecklistItem } from '../../types/task';

interface TaskChecklistProps {
  taskId: string;
  items: ChecklistItem[];
  /** Re-read the task after a write. */
  onChanged: () => Promise<void> | void;
}

/**
 * A task's checklist, inside the edit panel.
 *
 * For the steps that do not deserve a task of their own: no status, no
 * assignee, no due date — a line and a box. Writes are immediate, like the
 * subtasks above it, and for the same reason.
 */
export function TaskChecklist({ taskId, items, onChanged }: TaskChecklistProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const done = items.filter((i) => i.isDone).length;

  const add = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await tasksApi.addChecklistItem(taskId, value);
      setText('');
      taskChanged();
      await onChanged();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to add checklist item' });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item: ChecklistItem, isDone: boolean) => {
    try {
      await tasksApi.updateChecklistItem(taskId, item.id, { isDone });
      taskChanged();
      await onChanged();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to update checklist item' });
    }
  };

  const remove = async (item: ChecklistItem) => {
    try {
      await tasksApi.deleteChecklistItem(taskId, item.id);
      taskChanged();
      await onChanged();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to remove checklist item' });
    }
  };

  return (
    <section className="task-section" aria-labelledby="task-checklist-heading">
      <div className="task-section__header">
        <h4 id="task-checklist-heading" className="task-section__title">Checklist</h4>
        {items.length > 0 && (
          <span className="task-section__count">{done} of {items.length} done</span>
        )}
      </div>

      {items.length > 0 && (
        <ProgressBar
          label="Checklist done"
          hideLabel
          size="small"
          value={done}
          max={items.length}
          status={done === items.length ? 'finished' : 'active'}
          className="task-section__progress"
        />
      )}

      {items.length > 0 && (
        <ul className="task-section__list">
          {items.map((item) => (
            <li key={item.id} className={`task-section__item${item.isDone ? ' task-section__item--done' : ''}`}>
              <input
                type="checkbox"
                className="task-section__check"
                checked={item.isDone}
                aria-label={`${item.isDone ? 'Untick' : 'Tick'}: ${item.text}`}
                onChange={(e) => toggle(item, e.target.checked)}
              />
              <span className="task-section__text">{item.text}</span>
              <Button
                kind="danger--ghost"
                size="sm"
                hasIconOnly
                renderIcon={TrashCan}
                iconDescription={`Remove: ${item.text}`}
                className="task-section__remove"
                onClick={() => void remove(item)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="task-section__add">
        <TextInput
          id="new-checklist-item"
          labelText="New checklist item"
          hideLabel
          size="sm"
          placeholder="Add an item…"
          value={text}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
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
          iconDescription="Add checklist item"
          disabled={!text.trim() || busy}
          onClick={() => void add()}
        />
      </div>
    </section>
  );
}
