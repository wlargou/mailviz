import { Tag } from '@carbon/react';
import { ListChecked, Locked, TreeViewAlt } from '@carbon/icons-react';
import type { Task } from '../../types/task';

/**
 * The two small counters a task row carries when it has structure below it:
 * subtasks done, and checklist lines done. Renders nothing for a plain task,
 * so callers can drop it into any row without a guard.
 *
 * A `Tag` rather than a progress bar: on a Kanban card or a table row the
 * number is the information, and "2/5" reads faster than a fill level. The
 * detail panel is where the bar belongs.
 *
 * The icon is a child, not `renderIcon`: Carbon's Tag drops `renderIcon`
 * entirely at `size="sm"`, and the small size is the right one for a row.
 */
export function TaskProgressTags({ task }: { task: Pick<Task, 'subtaskCount' | 'subtaskDoneCount' | 'checklistCount' | 'checklistDoneCount' | 'openBlockerCount'> }) {
  const subtasks = task.subtaskCount ?? 0;
  const checklist = task.checklistCount ?? 0;
  const blockers = task.openBlockerCount ?? 0;
  if (subtasks === 0 && checklist === 0 && blockers === 0) return null;

  return (
    <span className="task-progress-tags">
      {blockers > 0 && (
        <Tag size="sm" type="red" title={`Blocked by ${blockers} unfinished ${blockers === 1 ? 'task' : 'tasks'}`}>
          <Locked size={12} className="task-progress-tags__icon" aria-hidden="true" />
          Blocked
        </Tag>
      )}
      {subtasks > 0 && (
        <Tag
          size="sm"
          type={task.subtaskDoneCount === subtasks ? 'green' : 'cool-gray'}
          title={`${task.subtaskDoneCount} of ${subtasks} subtasks done`}
        >
          <TreeViewAlt size={12} className="task-progress-tags__icon" aria-hidden="true" />
          {task.subtaskDoneCount}/{subtasks}
        </Tag>
      )}
      {checklist > 0 && (
        <Tag
          size="sm"
          type={task.checklistDoneCount === checklist ? 'green' : 'cool-gray'}
          title={`${task.checklistDoneCount} of ${checklist} checklist items done`}
        >
          <ListChecked size={12} className="task-progress-tags__icon" aria-hidden="true" />
          {task.checklistDoneCount}/{checklist}
        </Tag>
      )}
    </span>
  );
}

/** The one-line breadcrumb a subtask shows above its title. */
export function TaskParentCrumb({ parent, onOpen }: { parent: Task['parent']; onOpen?: (id: string) => void }) {
  if (!parent) return null;
  const label = parent.title;
  if (!onOpen) {
    return <span className="task-parent-crumb">{label}</span>;
  }
  return (
    <button
      type="button"
      className="task-parent-crumb task-parent-crumb--link"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(parent.id);
      }}
      title={`Open parent task: ${label}`}
    >
      {label}
    </button>
  );
}
