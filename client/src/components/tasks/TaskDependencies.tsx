import { useEffect, useRef, useState } from 'react';
import { Button, ComboBox, Tag } from '@carbon/react';
import { Checkmark, Close, Locked } from '@carbon/icons-react';
import { tasksApi } from '../../api/tasks';
import { useUIStore } from '../../store/uiStore';
import { useTaskStore } from '../../store/taskStore';
import { decodeEntities } from '../../utils/text';
import { apiErrorMessage } from '../../utils/apiError';
import type { Task, TaskRef, TaskStatusConfig } from '../../types/task';

interface TaskDependenciesProps {
  task: Task;
  statuses: TaskStatusConfig[];
  onOpenTask?: (id: string) => void;
  onChanged: () => Promise<void> | void;
}

interface PickerItem {
  id: string;
  text: string;
}

/**
 * What a task waits on, and what waits on it.
 *
 * "Blocked by" is editable here: a server-searched picker adds a blocker,
 * and each row can be removed. "Blocks" is the same table read the other
 * way and is edited from the other task's panel — one place to change a
 * dependency, seen from both ends.
 *
 * A blocker is shown as open or finished by the account's terminal statuses,
 * because that is exactly what decides whether this task may be completed.
 */
export function TaskDependencies({ task, statuses, onOpenTask, onChanged }: TaskDependenciesProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [items, setItems] = useState<PickerItem[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * Remounts the picker after a pick. Carbon's ComboBox keeps the chosen
   * text in its input even with `selectedItem={null}`, and a picker that
   * still reads "Chase the NDA" after the NDA is already in the list above
   * looks like it did not work.
   */
  const [pickerKey, setPickerKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminal = new Set(statuses.filter((s) => s.isTerminal).map((s) => s.name));

  const blockedBy = task.blockedBy ?? [];
  const blocks = task.blocks ?? [];
  const open = blockedBy.filter((b) => !terminal.has(b.status)).length;

  const excluded = new Set([task.id, ...blockedBy.map((b) => b.id)]);

  const search = (query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const { data: res } = await tasksApi.getAll({ search: query, limit: '10', sortBy: 'updatedAt', sortOrder: 'desc' });
        setItems(
          res.data
            .filter((t) => !excluded.has(t.id))
            .map((t) => ({ id: t.id, text: decodeEntities(t.title) }))
        );
      } catch {
        setItems([]);
      }
    }, 300);
  };

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const add = async (blockerId: string) => {
    setBusy(true);
    try {
      await tasksApi.addDependency(task.id, blockerId);
      setItems([]);
      setPickerKey((k) => k + 1);
      taskChanged();
      await onChanged();
    } catch (err) {
      addNotification({ kind: 'error', title: 'Could not add the dependency', subtitle: apiErrorMessage(err, '') });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (blockerId: string) => {
    try {
      await tasksApi.removeDependency(task.id, blockerId);
      taskChanged();
      await onChanged();
    } catch {
      addNotification({ kind: 'error', title: 'Could not remove the dependency' });
    }
  };

  const row = (ref: TaskRef, action?: React.ReactNode) => {
    const done = terminal.has(ref.status);
    const label = decodeEntities(ref.title);
    return (
      <li key={ref.id} className={`task-section__item${done ? ' task-section__item--done' : ''}`}>
        {/* The title sits on the icon's wrapper: Carbon's Tag keeps `title`
            for its own dismiss button and does not put it on the element. */}
        <Tag size="sm" type={done ? 'green' : 'red'}>
          <span className="task-section__state" title={done ? 'Finished' : 'Not finished'}>
            {done ? <Checkmark size={12} aria-hidden="true" /> : <Locked size={12} aria-hidden="true" />}
          </span>
        </Tag>
        <button
          type="button"
          className="task-section__text task-section__text--link"
          onClick={() => onOpenTask?.(ref.id)}
          disabled={!onOpenTask}
          title={onOpenTask ? `Open ${label}` : undefined}
        >
          {label}
        </button>
        {action}
      </li>
    );
  };

  return (
    <section className="task-section" aria-labelledby="task-dependencies-heading">
      <div className="task-section__header">
        <h4 id="task-dependencies-heading" className="task-section__title">Dependencies</h4>
        {blockedBy.length > 0 && (
          <span className="task-section__count">
            {open > 0 ? `Blocked by ${open} of ${blockedBy.length}` : `All ${blockedBy.length} finished`}
          </span>
        )}
      </div>

      <p className="task-section__subheading">Blocked by</p>
      {blockedBy.length > 0 && (
        <ul className="task-section__list">
          {blockedBy.map((ref) =>
            row(
              ref,
              <Button
                kind="ghost"
                size="sm"
                hasIconOnly
                renderIcon={Close}
                iconDescription={`Remove blocker: ${decodeEntities(ref.title)}`}
                className="task-section__remove"
                onClick={() => void remove(ref.id)}
              />
            )
          )}
        </ul>
      )}
      <div className="task-section__add">
        <ComboBox
          key={pickerKey}
          id="task-add-blocker"
          titleText="Add a blocker"
          size="sm"
          placeholder="Search a task this one waits on…"
          items={items}
          itemToString={(item: PickerItem | null) => item?.text ?? ''}
          onInputChange={(text: string) => search(text)}
          onChange={({ selectedItem }: { selectedItem?: PickerItem | null }) => {
            if (selectedItem) void add(selectedItem.id);
          }}
          selectedItem={null}
          disabled={busy}
        />
      </div>

      {blocks.length > 0 && (
        <>
          <p className="task-section__subheading">Blocks</p>
          <ul className="task-section__list">{blocks.map((ref) => row(ref))}</ul>
        </>
      )}
    </section>
  );
}
