import { SkeletonText, Button } from '@carbon/react';
import { ArrowRight } from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { TaskStatusTag } from '../shared/TaskStatusTag';
import { PriorityBadge } from '../shared/PriorityBadge';
import type { DashboardStats } from '../../types/dashboard';
import type { Task } from '../../types/task';

interface RecentTasksProps {
  stats: DashboardStats | null;
  loading: boolean;
  onTaskClick?: (task: Task) => void;
}

export function RecentTasks({ stats, loading, onTaskClick }: RecentTasksProps) {
  const navigate = useNavigate();

  if (loading || !stats) {
    return (
      <div>
        <SkeletonText paragraph lineCount={3} />
      </div>
    );
  }

  const { tasks } = stats;

  if (tasks.recentTasks.length === 0) {
    return <div className="card-empty">No tasks yet</div>;
  }

  return (
    <div className="dashboard-item-list">
      {tasks.recentTasks.slice(0, 5).map((task) => (
        <div
          key={task.id}
          className="dashboard-item dashboard-item--task"
          onClick={() => {
            if (onTaskClick) onTaskClick(task as Task);
            else navigate('/tasks');
          }}
        >
          <div className="dashboard-item__badge">
            <PriorityBadge priority={task.priority} />
          </div>
          <div className="dashboard-item__info">
            <span className="dashboard-item__title">{task.title}</span>
            <span className="dashboard-item__sub">{task.customer?.name || 'No company'}</span>
          </div>
          <div className="dashboard-item__tag">
            <TaskStatusTag status={task.status} />
          </div>
        </div>
      ))}
      <Button kind="ghost" size="sm" renderIcon={ArrowRight} className="dashboard-item-list__view-all" onClick={() => navigate('/tasks')}>
        View all tasks
      </Button>
    </div>
  );
}
