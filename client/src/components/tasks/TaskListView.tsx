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
import { TableFilterFlyout } from '../shared/TableFilterFlyout';
import { ShareDialog } from '../shared/ShareDialog';
import { useTaskStore } from '../../store/taskStore';
import { taskStatusesApi } from '../../api/taskStatuses';
import { tasksApi } from '../../api/tasks';
import { useUIStore } from '../../store/uiStore';
import type { Task, Label, TaskStatusConfig } from '../../types/task';

const headers = [
  { key: 'title', header: 'Title' },
  { key: 'status', header: 'Status' },
  { key: 'priority', header: 'Priority' },
  { key: 'dueDate', header: 'Due Date' },
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

interface TaskListViewProps {
  tasks: Task[];
  loading: boolean;
  labels: Label[];
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onCreateNew: () => void;
}

export function TaskListView({ tasks, loading, labels, onEdit, onDelete, onCreateNew }: TaskListViewProps) {
  const { meta, setPage, setPageSize, setFilter, filters, currentPage, pageSize, resetFilters } = useTaskStore();
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
  }, []);

  const labelItems = [
    { id: '', text: 'All Labels' },
    ...labels.map((l) => ({ id: l.id, text: l.name })),
  ];

  const activeFilterCount = (filters.status ? 1 : 0) + (filters.priority ? 1 : 0) + (filters.labelId ? 1 : 0);

  const handleSearchChange = useCallback((e: any) => {
    const val = typeof e === 'string' ? e : (e?.target?.value ?? '');
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

  if (tasks.length === 0 && !localSearch) {
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
        {({ getTableProps, getHeaderProps }) => (
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
                    <TableHeader {...getHeaderProps({ header })} key={header.key}>
                      {header.header}
                    </TableHeader>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {tasks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={headers.length}>
                      <EmptyState title="No results" description={`No tasks match "${localSearch}"`} />
                    </TableCell>
                  </TableRow>
                ) : tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <span style={{ cursor: 'pointer', fontWeight: 500 }} onClick={() => onEdit(task)}>
                        {task.title}
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
        title={shareTask?.title || ''}
        currentShares={taskShares}
        onShare={async (userIds) => {
          if (!shareTask) return;
          await tasksApi.shareTask(shareTask.id, userIds);
          addNotification({ kind: 'success', title: 'Task shared' });
        }}
        onUnshare={async (userId) => {
          if (!shareTask) return;
          await tasksApi.unshareTask(shareTask.id, userId);
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
