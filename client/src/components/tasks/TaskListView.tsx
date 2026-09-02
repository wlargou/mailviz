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
  Button,
  Pagination,
  DataTableSkeleton,
  Dropdown,
} from '@carbon/react';
import { Add, Edit, TrashCan, Share } from '@carbon/icons-react';
import { format } from 'date-fns';
import { TaskStatusTag } from '../shared/TaskStatusTag';
import { PriorityBadge } from '../shared/PriorityBadge';
import { LabelTag } from '../shared/LabelTag';
import { EmptyState } from '../shared/EmptyState';
import { SharedBadge } from '../shared/SharedBadge';
import { TableFilterFlyout } from '../shared/TableFilterFlyout';
import { ShareDialog } from '../shared/ShareDialog';
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

const ownershipItems = [
  { id: '', text: 'All Tasks' },
  { id: 'shared', text: 'Shared with me' },
  { id: 'owned', text: 'Owned by me' },
];

interface TaskListViewProps {
  tasks: Task[];
  loading: boolean;
  labels: Label[];
  onEdit: (task: Task) => void;
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

  useEffect(() => {
    taskStatusesApi.getAll().then(({ data: res }) => {
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
    (filters.ownership ? 1 : 0);

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
        {({ getTableProps }) => (
          <TableContainer className="tasks-table">
            <TableToolbar>
              <TableToolbarContent>
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
                    <TableCell colSpan={headers.length}>
                      <EmptyState
                        title="No results"
                        description={localSearch ? `No tasks match "${localSearch}"` : 'No tasks match your filters'}
                      />
                    </TableCell>
                  </TableRow>
                ) : tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <span className="shared-title-cell">
                        <span style={{ cursor: 'pointer', fontWeight: 500 }} onClick={() => onEdit(task)}>
                          {decodeEntities(task.title)}
                        </span>
                        <SharedBadge ownerId={task.userId} />
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
                        <Button kind="ghost" size="sm" hasIconOnly renderIcon={Edit} iconDescription="Edit" onClick={() => onEdit(task)} />
                        <Button kind="danger--ghost" size="sm" hasIconOnly renderIcon={TrashCan} iconDescription="Delete" onClick={() => onDelete(task)} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DataTable>
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
