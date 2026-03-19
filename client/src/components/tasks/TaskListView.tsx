import {
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  Button,
  Pagination,
  DataTableSkeleton,
  Search,
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

  if (loading) {
    return <DataTableSkeleton headers={headers} rowCount={5} />;
  }

  if (tasks.length === 0) {
    return <EmptyState title="No tasks found" description="Try adjusting your filters or create a new task" />;
  }

  return (
    <>
      <Search
        size="sm"
        placeholder="Search tasks..."
        labelText="Search"
        closeButtonLabelText="Clear"
        value={filters.search || ''}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          setFilter('search', e.target.value || undefined);
        }}
        style={{ marginBottom: '1rem' }}
      />
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              {headers.map((header) => (
                <TableHeader key={header.key}>
                  {header.header}
                </TableHeader>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell>
                  <span
                    style={{ cursor: 'pointer', fontWeight: 500 }}
                    onClick={() => onEdit(task)}
                  >
                    {task.title}
                  </span>
                </TableCell>
                <TableCell>
                  <TaskStatusTag status={task.status} />
                </TableCell>
                <TableCell>
                  <PriorityBadge priority={task.priority} />
                </TableCell>
                <TableCell>
                  {task.dueDate ? (
                    <span
                      className={
                        new Date(task.dueDate) < new Date() && task.status !== 'DONE'
                          ? 'overdue-date'
                          : ''
                      }
                    >
                      {format(new Date(task.dueDate), 'MMM d, yyyy')}
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>
                  {task.customer ? (
                    <span style={{ fontSize: '0.875rem' }}>{task.customer.name}</span>
                  ) : '—'}
                </TableCell>
                <TableCell>
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                    {task.labels.map((label) => (
                      <LabelTag key={label.id} label={label} />
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="table-actions">
                    <Button
                      kind="ghost"
                      size="sm"
                      hasIconOnly
                      renderIcon={Edit}
                      iconDescription="Edit"
                      onClick={() => onEdit(task)}
                    />
                    <Button
                      kind="danger--ghost"
                      size="sm"
                      hasIconOnly
                      renderIcon={TrashCan}
                      iconDescription="Delete"
                      onClick={() => onDelete(task)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
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
