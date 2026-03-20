import { SkeletonText, Tag } from '@carbon/react';
import { Calendar, TaskComplete, Email } from '@carbon/icons-react';
import { format } from 'date-fns';
import { PriorityBadge } from '../shared/PriorityBadge';
import type { DashboardStats } from '../../types/dashboard';
import type { Task, TaskPriority } from '../../types/task';

interface MyDaySummaryProps {
  stats: DashboardStats | null;
  loading: boolean;
  onEventClick?: (eventId: string) => void;
  onTaskClick?: (task: Task) => void;
}

interface TimelineItem {
  type: 'event' | 'task';
  id: string;
  title: string;
  time: string;
  sortTime: number;
  priority?: string;
  location?: string | null;
  isAllDay?: boolean;
}

export function MyDaySummary({ stats, loading, onEventClick, onTaskClick }: MyDaySummaryProps) {
  if (loading || !stats) {
    return (
      <div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton-row--lg">
            <SkeletonText paragraph lineCount={2} />
          </div>
        ))}
      </div>
    );
  }

  const { myDay } = stats;

  // Build timeline
  const items: TimelineItem[] = [];

  for (const event of myDay.events) {
    const start = new Date(event.startTime);
    items.push({
      type: 'event',
      id: event.id,
      title: event.title,
      time: event.isAllDay ? 'All day' : format(start, 'h:mm a'),
      sortTime: event.isAllDay ? 0 : start.getTime(),
      location: event.location,
      isAllDay: event.isAllDay,
    });
  }

  for (const task of myDay.tasksDueToday) {
    const due = task.dueDate ? new Date(task.dueDate) : null;
    items.push({
      type: 'task',
      id: task.id,
      title: task.title,
      time: due ? format(due, 'h:mm a') : 'Today',
      sortTime: due ? due.getTime() : Number.MAX_SAFE_INTEGER,
      priority: task.priority,
    });
  }

  // Sort: all-day first, then by time
  items.sort((a, b) => a.sortTime - b.sortTime);

  const isEmpty = items.length === 0 && myDay.unreadTodayCount === 0;

  return (
    <div className="my-day">
      {/* Unread summary */}
      {myDay.unreadTodayCount > 0 && (
        <div className="my-day__unread">
          <Email size={14} />
          <span>{myDay.unreadTodayCount} unread email{myDay.unreadTodayCount !== 1 ? 's' : ''} today</span>
        </div>
      )}

      {isEmpty ? (
        <div className="card-empty">
          <p>Nothing scheduled for today</p>
        </div>
      ) : (
        <div className="my-day__timeline">
          {items.map((item) => (
            <div
              key={`${item.type}-${item.id}`}
              className={`my-day__item my-day__item--${item.type}`}
              onClick={() => {
                if (item.type === 'event' && onEventClick) {
                  onEventClick(item.id);
                } else if (item.type === 'task' && onTaskClick) {
                  const task = myDay.tasksDueToday.find((t) => t.id === item.id);
                  if (task) onTaskClick(task as unknown as Task);
                }
              }}
            >
              <span className="my-day__time">{item.time}</span>
              <span className="my-day__icon">
                {item.type === 'event' ? (
                  <Calendar size={14} />
                ) : (
                  <TaskComplete size={14} />
                )}
              </span>
              <div className="my-day__info">
                <span className="my-day__title">{item.title}</span>
                {item.type === 'task' && item.priority && (
                  <PriorityBadge priority={item.priority as TaskPriority} />
                )}
                {item.type === 'event' && item.location && (
                  <span className="my-day__location">{item.location}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
