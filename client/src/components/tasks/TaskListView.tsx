import { useState, useRef, useCallback, useEffect } from 'react';
import {
  DataTable,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  TableBatchActions,
  TableBatchAction,
  TableSelectAll,
  TableSelectRow,
  Button,
  Pagination,
  DataTableSkeleton,
  Dropdown,
} from '@carbon/react';
import { Add, Edit, TrashCan, Share, Migrate, UserFollow, Tag as TagIcon, CheckmarkOutline } from '@carbon/icons-react';
import { TaskBatchPicker, type PickerItem } from './TaskBatchPicker';
import { TaskViewsMenu } from './TaskViewsMenu';
import { authApi } from '../../api/auth';
import { apiErrorMessage } from '../../utils/apiError';
import type { BatchResult } from '../../types/task';
import { format } from 'date-fns';
import { TaskStatusTag } from '../shared/TaskStatusTag';
import { PriorityBadge } from '../shared/PriorityBadge';
import { LabelTag } from '../shared/LabelTag';
import { EmptyState } from '../shared/EmptyState';
import { SharedBadge } from '../shared/SharedBadge';
import { TableFilterFlyout } from '../shared/TableFilterFlyout';
import { ShareDialog } from '../shared/ShareDialog';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { TaskProgressTags, TaskParentCrumb } from './TaskProgressTags';
import { useTaskStore } from '../../store/taskStore';
import { taskStatusesApi } from '../../api/taskStatuses';
import { tasksApi } from '../../api/tasks';
import { useUIStore } from '../../store/uiStore';
import type { Task, Label, TaskStatusConfig } from '../../types/task';
import { toolbarSearchValue, type TableToolbarSearchChangeEvent } from '../../utils/carbonSearch';
import type { DataTableSortState } from '@carbon/react';
import { decodeEntities } from '../../utils/text';

/**
 * `sortField` names the API field a column orders by (`TASK_SORT_FIELDS` in
 * taskService). Columns without one are not sortable: company and labels come
 * from relations the endpoint does not order on.
 */
const headers = [
  { key: 'title', header: 'Title', sortField: 'title' },
  { key: 'status', header: 'Status', sortField: 'status' },
  { key: 'priority', header: 'Priority', sortField: 'priority' },
  { key: 'dueDate', header: 'Due Date', sortField: 'dueDate' },
  { key: 'customer', header: 'Company' },
  { key: 'labels', header: 'Labels' },
  { key: 'actions', header: '' },
];

const priorityItems = [
  { id: '', text: 'All Priorities' },
  { id: 'LOW', text: 'Low' },
  { id: 'MEDIUM', text: 'Medium' },
  { id: 'HIGH', text: 'High' },
  { id: 'URGENT', text: 'Urgent' },
];

const blockedItems = [
  { id: '', text: 'All Tasks' },
  { id: 'true', text: 'Blocked' },
  { id: 'false', text: 'Not blocked' },
];

const ownershipItems = [
  { id: '', text: 'All Tasks' },
  { id: 'shared', text: 'Shared with me' },
  { id: 'owned', text: 'Owned by me' },
];

interface TaskListViewProps {
  tasks: Task[];
  loading: boolean;
  labels: Label[];
  onEdit: (taskId: string) => void;
  onDelete: (task: Task) => void;
  onCreateNew: () => void;
}

export function TaskListView({ tasks, loading, labels, onEdit, onDelete, onCreateNew }: TaskListViewProps) {
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const statusesVersion = useTaskStore((s) => s.statusesVersion);
  const { meta, setPage, setPageSize, setFilter, filters, currentPage, pageSize, resetFilters } = useTaskStore();

  /**
   * Sorting goes through the store, which already put `sortBy`/`sortOrder` in the
   * request — the headers were simply never wired to it.
   *
   * They previously spread `getHeaderProps`, so Carbon rendered a sortable header
   * with a direction indicator while the body mapped over the unsorted `tasks`
   * array. The arrows moved and nothing else did.
   */
  const sortHeaderProps = (field: string) => {
    const active = filters.sortBy === field;
    return {
      isSortable: true,
      isSortHeader: active,
      sortDirection: (active
        ? filters.sortOrder === 'asc'
          ? 'ASC'
          : 'DESC'
        : 'NONE') as DataTableSortState,
      onClick: () => {
        if (active) {
          setFilter('sortOrder', filters.sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
          setFilter('sortBy', field);
          setFilter('sortOrder', 'asc');
        }
      },
    };
  };
  const [localSearch, setLocalSearch] = useState(filters.search || '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [statuses, setStatuses] = useState<{ id: string; text: string }[]>([{ id: '', text: 'All Statuses' }]);
  const [shareTask, setShareTask] = useState<Task | null>(null);
  const [taskShares, setTaskShares] = useState<any[]>([]);
  const addNotification = useUIStore((s) => s.addNotification);
  const [statusConfigs, setStatusConfigs] = useState<TaskStatusConfig[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; name: string | null; email: string }>>([]);
  /** Which batch picker is open, and for which selected ids. */
  const [picker, setPicker] = useState<{ kind: 'status' | 'assign' | 'label'; ids: string[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);

  useEffect(() => {
    authApi.getUsers().then(({ data: res }) => setUsers(res.data)).catch(() => {});
  }, []);

  /**
   * Report what a batch did. "Updated 4" is the whole story when nothing was
   * skipped; when something was, say how many and why the first one was,
   * since the reasons are usually all the same.
   */
  const report = (verb: string, result: BatchResult) => {
    const skipped = result.skipped.length;
    addNotification({
      kind: skipped > 0 && result.updated === 0 ? 'error' : skipped > 0 ? 'warning' : 'success',
      title: `${verb} ${result.updated} ${result.updated === 1 ? 'task' : 'tasks'}`,
      subtitle: skipped > 0 ? `${skipped} skipped: ${result.skipped[0]!.reason}` : undefined,
    });
    if (result.updated > 0) taskChanged();
  };

  const runBatch = async (fn: () => Promise<{ data: { data: BatchResult } }>, verb: string) => {
    try {
      const { data: res } = await fn();
      report(verb, res.data);
    } catch (err) {
      addNotification({ kind: 'error', title: `Could not ${verb.toLowerCase()} the tasks`, subtitle: apiErrorMessage(err, '') });
    }
  };

  useEffect(() => {
    taskStatusesApi.getAll().then(({ data: res }) => {
      setStatusConfigs(res.data);
      setStatuses([
        { id: '', text: 'All Statuses' },
        ...res.data.map((s: TaskStatusConfig) => ({ id: s.name, text: s.label })),
      ]);
    }).catch(() => {});
    // Re-read when the vocabulary changes: statuses are user-defined and the
    // Kanban board can add one, but Carbon keeps this panel mounted, so an
    // empty dep array left the filter dropdown missing the new column until
    // the user navigated away from /tasks and back.
  }, [statusesVersion]);

  const labelItems = [
    { id: '', text: 'All Labels' },
    ...labels.map((l) => ({ id: l.id, text: l.name })),
  ];

  const activeFilterCount =
    (filters.status ? 1 : 0) +
    (filters.priority ? 1 : 0) +
    (filters.labelId ? 1 : 0) +
    (filters.ownership ? 1 : 0) +
    (filters.blocked ? 1 : 0);

  const handleSearchChange = useCallback((e: TableToolbarSearchChangeEvent) => {
    const val = toolbarSearchValue(e);
    setLocalSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilter('search', val || undefined);
    }, 400);
  }, [setFilter]);

  // Refocus search input after loading completes while searching
  useEffect(() => {
    if (!loading && localSearch) {
      requestAnimationFrame(() => {
        const input = searchRef.current?.querySelector?.('input') ?? searchRef.current;
        if (input && typeof input.focus === 'function') {
          input.focus();
          if ('setSelectionRange' in input && typeof input.value === 'string') {
            (input as HTMLInputElement).setSelectionRange(input.value.length, input.value.length);
          }
        }
      });
    }
  }, [loading, localSearch]);

  if (loading && tasks.length === 0 && !localSearch) {
    return <DataTableSkeleton headers={headers} rowCount={5} />;
  }

  // Keep the toolbar mounted whenever a filter is on, otherwise a filter that
  // matches nothing (e.g. "Shared with me" with no shares) hides its own reset.
  if (tasks.length === 0 && !localSearch && activeFilterCount === 0) {
    return (
      <EmptyState
        title="No tasks found"
        description="Try adjusting your filters or create a new task"
        action={
          <Button kind="primary" size="sm" renderIcon={Add} onClick={onCreateNew}>
            New Task
          </Button>
        }
      />
    );
  }

  const rows = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate || '',
    customer: t.customer?.name || '',
    labels: '',
  }));

  return (
    <>
      <DataTable rows={rows} headers={headers}>
        {({ getTableProps, getSelectionProps, getBatchActionProps, selectedRows, getRowProps, rows: tableRows }) => {
          const batchActionProps = getBatchActionProps();
          const selectedIds = selectedRows.map((r) => r.id);
          const batchTab = batchActionProps.shouldShowBatchActions ? 0 : -1;
          return (
          <TableContainer className="tasks-table">
            <TableToolbar>
              <TableBatchActions {...batchActionProps}>
                <TableBatchAction tabIndex={batchTab} renderIcon={Migrate} onClick={() => setPicker({ kind: 'status', ids: selectedIds })}>
                  Move to…
                </TableBatchAction>
                <TableBatchAction tabIndex={batchTab} renderIcon={CheckmarkOutline} onClick={() => {
                  const done = statusConfigs.find((s) => s.isTerminal)?.name;
                  if (!done) {
                    addNotification({ kind: 'warning', title: 'No status is marked as finished', subtitle: 'Set one in Settings.' });
                    return;
                  }
                  void runBatch(() => tasksApi.batchStatus(selectedIds, done), 'Finished');
                }}>
                  Complete
                </TableBatchAction>
                <TableBatchAction tabIndex={batchTab} renderIcon={UserFollow} onClick={() => setPicker({ kind: 'assign', ids: selectedIds })}>
                  Assign…
                </TableBatchAction>
                <TableBatchAction tabIndex={batchTab} renderIcon={TagIcon} onClick={() => setPicker({ kind: 'label', ids: selectedIds })}>
                  Add label…
                </TableBatchAction>
                <TableBatchAction tabIndex={batchTab} renderIcon={TrashCan} onClick={() => setConfirmDelete(selectedIds)}>
                  Delete
                </TableBatchAction>
              </TableBatchActions>
              <TableToolbarContent aria-hidden={batchActionProps.shouldShowBatchActions}>
                <TaskViewsMenu />
                <TableToolbarSearch
                  ref={searchRef}
                  placeholder="Search tasks..."
                  value={localSearch}
                  onChange={handleSearchChange}
                  persistent
                />
                <TableFilterFlyout
                  activeFilterCount={activeFilterCount}
                  onReset={resetFilters}
                >
                  <Dropdown
                    id="filter-status"
                    titleText="Status"
                    label="All Statuses"
                    items={statuses}
                    itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
                    selectedItem={statuses.find((s) => s.id === (filters.status || '')) || statuses[0]}
                    onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => setFilter('status', selectedItem?.id || undefined)}
                    size="sm"
                  />
                  <Dropdown
                    id="filter-priority"
                    titleText="Priority"
                    label="All Priorities"
                    items={priorityItems}
                    itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
                    selectedItem={priorityItems.find((p) => p.id === (filters.priority || '')) || priorityItems[0]}
                    onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => setFilter('priority', selectedItem?.id || undefined)}
                    size="sm"
                  />
                  <Dropdown
                    id="filter-label"
                    titleText="Label"
                    label="All Labels"
                    items={labelItems}
                    itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
                    selectedItem={labelItems.find((l) => l.id === (filters.labelId || '')) || labelItems[0]}
                    onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => setFilter('labelId', selectedItem?.id || undefined)}
                    size="sm"
                  />
                  <Dropdown
                    id="filter-blocked"
                    titleText="Dependencies"
                    label="All Tasks"
                    items={blockedItems}
                    itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
                    selectedItem={blockedItems.find((b) => b.id === (filters.blocked || '')) || blockedItems[0]}
                    onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => setFilter('blocked', selectedItem?.id || undefined)}
                    size="sm"
                  />
                  <Dropdown
                    id="filter-ownership"
                    titleText="Shared"
                    label="All Tasks"
                    items={ownershipItems}
                    itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
                    selectedItem={ownershipItems.find((o) => o.id === (filters.ownership || '')) || ownershipItems[0]}
                    onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => setFilter('ownership', selectedItem?.id || undefined)}
                    size="sm"
                  />
                </TableFilterFlyout>
                <Button renderIcon={Add} onClick={onCreateNew}>
                  New Task
                </Button>
              </TableToolbarContent>
            </TableToolbar>
            <Table {...getTableProps()} size="lg">
              <TableHead>
                <TableRow>
                  <TableSelectAll {...getSelectionProps()} />
                  {headers.map((header) => (
                    <TableHeader
                      key={header.key}
                      {...(header.sortField ? sortHeaderProps(header.sortField) : {})}
                    >
                      {header.header}
                    </TableHeader>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {tasks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={headers.length + 1}>
                      <EmptyState
                        title="No results"
                        description={localSearch ? `No tasks match "${localSearch}"` : 'No tasks match your filters'}
                      />
                    </TableCell>
                  </TableRow>
                ) : tasks.map((task, i) => {
                  // Carbon's own row object carries `isSelected`; a bare id
                  // would leave the checkbox unchecked while the count said
                  // otherwise. `rows` was built from `tasks` in order.
                  const tableRow = tableRows[i];
                  return (
                  <TableRow key={task.id} {...(tableRow ? getRowProps({ row: tableRow }) : {})}>
                    {tableRow ? <TableSelectRow {...getSelectionProps({ row: tableRow })} /> : <TableCell />}
                    <TableCell>
                      <span className="shared-title-cell">
                        <span className="task-title-stack">
                          {task.parent && (
                            <TaskParentCrumb
                              parent={{ ...task.parent, title: decodeEntities(task.parent.title) }}
                              onOpen={onEdit}
                            />
                          )}
                          <span style={{ cursor: 'pointer', fontWeight: 500 }} onClick={() => onEdit(task.id)}>
                            {decodeEntities(task.title)}
                          </span>
                        </span>
                        <SharedBadge ownerId={task.userId} />
                        <TaskProgressTags task={task} />
                      </span>
                    </TableCell>
                    <TableCell><TaskStatusTag status={task.status} /></TableCell>
                    <TableCell><PriorityBadge priority={task.priority} /></TableCell>
                    <TableCell>
                      {task.dueDate ? (
                        <span className={new Date(task.dueDate) < new Date() && task.status !== 'DONE' ? 'overdue-date' : ''}>
                          {format(new Date(task.dueDate), 'MMM d, yyyy')}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell>{task.customer ? task.customer.name : '—'}</TableCell>
                    <TableCell>
                      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                        {task.labels.map((label) => <LabelTag key={label.id} label={label} />)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="table-actions">
                        <Button kind="ghost" size="sm" hasIconOnly renderIcon={Share} iconDescription="Share"
                          onClick={async () => {
                            try {
                              const { data: res } = await tasksApi.getTaskShares(task.id);
                              setTaskShares(res.data);
                            } catch { setTaskShares([]); }
                            setShareTask(task);
                          }}
                        />
                        <Button kind="ghost" size="sm" hasIconOnly renderIcon={Edit} iconDescription="Edit" onClick={() => onEdit(task.id)} />
                        <Button kind="danger--ghost" size="sm" hasIconOnly renderIcon={TrashCan} iconDescription="Delete" onClick={() => onDelete(task)} />
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          );
        }}
      </DataTable>

      <TaskBatchPicker
        open={picker?.kind === 'status'}
        heading={`Move ${picker?.ids.length ?? 0} ${picker?.ids.length === 1 ? 'task' : 'tasks'} to…`}
        label="Status"
        items={statusConfigs.map((s) => ({ id: s.name, text: s.label }))}
        onClose={() => setPicker(null)}
        onPick={async (item: PickerItem) => {
          const ids = picker?.ids ?? [];
          setPicker(null);
          await runBatch(() => tasksApi.batchStatus(ids, item.id), 'Moved');
        }}
      />
      <TaskBatchPicker
        open={picker?.kind === 'assign'}
        heading={`Assign ${picker?.ids.length ?? 0} ${picker?.ids.length === 1 ? 'task' : 'tasks'} to…`}
        label="Assignee"
        items={[{ id: '', text: 'Unassigned' }, ...users.map((u) => ({ id: u.id, text: u.name || u.email }))]}
        onClose={() => setPicker(null)}
        onPick={async (item: PickerItem) => {
          const ids = picker?.ids ?? [];
          setPicker(null);
          await runBatch(() => tasksApi.batchAssign(ids, item.id || null), 'Assigned');
        }}
      />
      <TaskBatchPicker
        open={picker?.kind === 'label'}
        heading={`Add a label to ${picker?.ids.length ?? 0} ${picker?.ids.length === 1 ? 'task' : 'tasks'}`}
        label="Label"
        items={labels.map((l) => ({ id: l.id, text: l.name }))}
        onClose={() => setPicker(null)}
        onPick={async (item: PickerItem) => {
          const ids = picker?.ids ?? [];
          setPicker(null);
          await runBatch(() => tasksApi.batchLabel(ids, item.id), 'Labelled');
        }}
      />
      <ConfirmDeleteModal
        open={!!confirmDelete}
        title={`${confirmDelete?.length ?? 0} ${confirmDelete?.length === 1 ? 'task' : 'tasks'}`}
        entityLabel="tasks"
        consequence="Their subtasks, checklists, comments and time entries go with them. Tasks shared with you but not yours are skipped."
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          const ids = confirmDelete ?? [];
          setConfirmDelete(null);
          void runBatch(() => tasksApi.batchDelete(ids), 'Deleted');
        }}
      />
      {meta && (meta.totalPages > 1 || pageSize !== 20) && (
        <Pagination
          totalItems={meta.total}
          pageSize={pageSize}
          pageSizes={[10, 20, 50]}
          page={currentPage}
          onChange={({ page: p, pageSize: ps }: { page: number; pageSize: number }) => {
            if (ps !== pageSize) setPageSize(ps);
            else setPage(p);
          }}
        />
      )}

      <ShareDialog
        open={!!shareTask}
        onClose={() => setShareTask(null)}
        title={decodeEntities(shareTask?.title)}
        currentShares={taskShares}
        onShare={async (userIds) => {
          if (!shareTask) return;
          await tasksApi.shareTask(shareTask.id, userIds);
          taskChanged();
          addNotification({ kind: 'success', title: 'Task shared' });
        }}
        onUnshare={async (userId) => {
          if (!shareTask) return;
          await tasksApi.unshareTask(shareTask.id, userId);
          taskChanged();
          addNotification({ kind: 'success', title: 'Share removed' });
        }}
        onRefresh={async () => {
          if (!shareTask) return;
          try {
            const { data: res } = await tasksApi.getTaskShares(shareTask.id);
            setTaskShares(res.data);
          } catch { setTaskShares([]); }
        }}
      />
    </>
  );
}
