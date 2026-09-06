import { useCallback, useEffect, useState } from 'react';
import { Button, MenuButton, MenuItem, MenuItemDivider, Modal, TextInput } from '@carbon/react';
import { Save } from '@carbon/icons-react';
import { tasksApi } from '../../api/tasks';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import { apiErrorMessage } from '../../utils/apiError';
import type { TaskView } from '../../types/task';

/**
 * Saved views of the task list.
 *
 * A view is the filters and sort the list had on, under a name. Picking one
 * replaces the current filters; "Save view" keeps the current ones. The
 * store owns the filters, so this is a thin menu over it.
 */
const FILTER_WORDS: Record<string, (v: string | boolean) => string> = {
  search: (v) => `matching “${String(v)}”`,
  status: (v) => `status ${String(v).replace(/_/g, ' ').toLowerCase()}`,
  priority: (v) => `${String(v).toLowerCase()} priority`,
  labelId: () => 'one label',
  overdue: () => 'overdue',
  ownership: (v) => (v === 'shared' ? 'shared with me' : 'mine'),
  blocked: (v) => (v === 'true' ? 'blocked' : 'not blocked'),
};

const SORT_WORDS: Record<string, string> = {
  createdAt: 'date added',
  dueDate: 'due date',
  priority: 'priority',
  status: 'status',
  title: 'title',
  updatedAt: 'last change',
};

/** What the view will bring back, in words rather than query keys. */
export function describeView(filters: Record<string, string | boolean>, sortBy: string, sortOrder: string): string {
  const parts = Object.entries(filters).map(([k, v]) => (FILTER_WORDS[k] ?? ((x: string | boolean) => `${k} ${String(x)}`))(v));
  const what = parts.length ? `Keeps tasks ${parts.join(', ')}` : 'Keeps every task';
  const order = sortOrder === 'asc' ? 'ascending' : 'descending';
  return `${what}, sorted by ${SORT_WORDS[sortBy] ?? sortBy} ${order}.`;
}

export function TaskViewsMenu() {
  const addNotification = useUIStore((s) => s.addNotification);
  const filters = useTaskStore((s) => s.filters);
  const applyView = useTaskStore((s) => s.applyView);
  const [views, setViews] = useState<TaskView[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: res } = await tasksApi.getViews();
      setViews(res.data);
    } catch {
      setViews([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { sortBy, sortOrder, ...rest } = filters;
  const activeFilters = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined && v !== '' && v !== false)
  ) as Record<string, string | boolean>;
  const hasFilters = Object.keys(activeFilters).length > 0 || sortBy !== 'createdAt' || sortOrder !== 'desc';

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await tasksApi.saveView({ name: name.trim(), filters: activeFilters, sortBy, sortOrder });
      addNotification({ kind: 'success', title: `View “${name.trim()}” saved` });
      setSaveOpen(false);
      setName('');
      await load();
    } catch (err) {
      addNotification({ kind: 'error', title: 'Could not save the view', subtitle: apiErrorMessage(err, '') });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (view: TaskView) => {
    try {
      await tasksApi.deleteView(view.id);
      await load();
    } catch {
      addNotification({ kind: 'error', title: 'Could not delete the view' });
    }
  };

  return (
    <>
      <MenuButton label="Views" kind="ghost" size="md" menuAlignment="bottom-start">
        {views.length === 0 && <MenuItem label="No saved views yet" disabled />}
        {views.map((v) => (
          <MenuItem key={v.id} label={v.name} onClick={() => applyView(v.filters, v.sortBy, v.sortOrder)} />
        ))}
        {views.length > 0 && <MenuItemDivider />}
        {views.map((v) => (
          <MenuItem key={`delete-${v.id}`} label={`Delete “${v.name}”`} kind="danger" onClick={() => void remove(v)} />
        ))}
      </MenuButton>
      <Button kind="ghost" size="md" renderIcon={Save} disabled={!hasFilters} onClick={() => setSaveOpen(true)} title={hasFilters ? undefined : 'Set a filter or sort first'}>
        Save view
      </Button>

      <Modal
        open={saveOpen}
        size="xs"
        modalHeading="Save the current view"
        primaryButtonText={busy ? 'Saving…' : 'Save'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={!name.trim() || busy}
        onRequestClose={() => setSaveOpen(false)}
        onRequestSubmit={() => void save()}
      >
        <TextInput
          id="task-view-name"
          labelText="View name"
          placeholder="e.g. Urgent, mine"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') void save();
          }}
          maxLength={80}
        />
        <p className="modal-form__helper">{describeView(activeFilters, sortBy, sortOrder)}</p>
      </Modal>
    </>
  );
}
