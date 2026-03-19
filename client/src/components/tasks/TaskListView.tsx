import { useState, useRef, useCallback } from 'react';
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
} from '@carbon/react';
import { Edit, TrashCan } from '@carbon/icons-react';
import { format } from 'date-fns';
import { TaskStatusTag } from '../shared/TaskStatusTag';
import { PriorityBadge } from '../shared/PriorityBadge';
import { LabelTag } from '../shared/LabelTag';
import { EmptyState } from '../shared/EmptyState';
import { useTaskStore } from '../../store/taskStore';
import type { Task } from '../../types/task';

const headers = [
  { key: 'title', header: 'Title' },
  { key: 'status', header: 'Status' },
  { key: 'priority', header: 'Priority' },
  { key: 'dueDate', header: 'Due Date' },
  { key: 'customer', header: 'Customer' },
  { key: 'labels', header: 'Labels' },
  { key: 'actions', header: '' },
];

interface TaskListViewProps {
  tasks: Task[];
  loading: boolean;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function TaskListView({ tasks, loading, onEdit, onDelete }: TaskListViewProps) {
  const { meta, setPage, setFilter, filters, currentPage } = useTaskStore();
  const [localSearch, setLocalSearch] = useState(filters.search || '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilter('search', val || undefined);
    }, 400);
  }, [setFilter]);

  if (loading && tasks.length === 0) {
    return <DataTableSkeleton headers={headers} rowCount={5} />;
  }

  if (tasks.length === 0 && !localSearch) {
    return <EmptyState title="No tasks found" description="Try adjusting your filters or create a new task" />;
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
          <TableContainer>
            <TableToolbar>
              <TableToolbarContent>
                <TableToolbarSearch
                  placeholder="Search tasks..."
                  value={localSearch}
                  onChange={handleSearchChange}
                  persistent
                />
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
      {meta && meta.totalPages > 1 && (
        <Pagination
          totalItems={meta.total}
          pageSize={meta.limit}
          pageSizes={[10, 20, 50]}
          page={currentPage}
          onChange={({ page }: { page: number }) => setPage(page)}
        />
      )}
    </>
  );
}
