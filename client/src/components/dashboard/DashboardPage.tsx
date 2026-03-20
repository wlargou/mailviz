import { useEffect, useState, useCallback } from 'react';
import { Grid, Column, Tile } from '@carbon/react';
import { useNavigate } from 'react-router-dom';
import { SidePanel } from '@carbon/ibm-products';
import { TaskSummaryTiles } from './TaskSummaryTiles';
import { MyDaySummary } from './MyDaySummary';
import { RecentActivity } from './RecentActivity';
import { EmailVolumeChart } from './EmailVolumeChart';
import { TaskStatusDonut } from './TaskStatusDonut';
import { TopCustomers } from './TopCustomers';
import { NeedsAttention } from './NeedsAttention';
import { FrequentContacts } from './FrequentContacts';
import { UpcomingEvents } from './UpcomingEvents';
import { QuickAddTask } from './QuickAddTask';
import { ThreadDetail } from '../mail/ThreadDetail';
import { TaskDetailModal } from '../tasks/TaskDetailModal';
import { EventDetailModal } from '../calendar/EventDetailModal';
import { dashboardApi } from '../../api/dashboard';
import { labelsApi } from '../../api/labels';
import { calendarApi } from '../../api/calendar';
import { useUIStore } from '../../store/uiStore';
import type { DashboardStats } from '../../types/dashboard';
import type { Task, Label } from '../../types/task';
import type { CalendarEvent } from '../../types/calendar';

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Email SidePanel state
  const [selectedThread, setSelectedThread] = useState<{ id: string; subject: string } | null>(null);

  // Task Detail Modal state
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);

  // Event Detail Modal state
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await dashboardApi.getStats();
      setStats(res.data);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    labelsApi.getAll().then(({ data: res }) => setLabels(res.data)).catch(() => {});
  }, []);

  const handleEmailClick = (threadId: string, subject: string) => {
    setSelectedThread({ id: threadId, subject });
  };

  const handleTaskClick = (task: Task) => {
    setEditTask(task);
  };

  const handleEventClick = async (eventId: string) => {
    try {
      const { data: res } = await calendarApi.getById(eventId);
      setDetailEvent(res.data);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load event' });
    }
  };

  const handleEventEdit = () => {
    setDetailEvent(null);
    navigate('/calendar');
  };

  const handleEventDelete = async (event: CalendarEvent, mode: 'single' | 'all' = 'single') => {
    try {
      await calendarApi.delete(event.id, mode);
      addNotification({ kind: 'success', title: mode === 'all' ? 'Recurring series deleted' : 'Event deleted' });
      setDetailEvent(null);
      fetchData();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete event' });
    }
  };

  const handleEventRespond = async (event: CalendarEvent, response: 'accepted' | 'declined' | 'tentative') => {
    try {
      const { data: result } = await calendarApi.respond(event.id, response);
      addNotification({ kind: 'success', title: `Responded: ${response}` });
      setDetailEvent(result.data);
      fetchData();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to respond to event' });
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__info">
          <h1>Dashboard</h1>
          <p className="page-header__subtitle">Overview of your CRM activity</p>
        </div>
      </div>

      {/* Row 1: Metric tiles */}
      <TaskSummaryTiles stats={stats} loading={loading} />

      <Grid fullWidth className="dashboard-grid">
        {/* Row 2: My Day + Upcoming Events */}
        <Column lg={8} md={4} sm={4}>
          <Tile className="card">
            <div className="card__header">
              <h4 className="card__title">My Day</h4>
            </div>
            <div className="card__content">
              <MyDaySummary
                stats={stats}
                loading={loading}
                onEventClick={handleEventClick}
                onTaskClick={handleTaskClick}
              />
            </div>
          </Tile>
        </Column>
        <Column lg={8} md={4} sm={4}>
          <Tile className="card">
            <div className="card__header">
              <h4 className="card__title">Upcoming Events</h4>
            </div>
            <div className="card__content">
              <UpcomingEvents stats={stats} loading={loading} onEventClick={handleEventClick} />
            </div>
          </Tile>
        </Column>

        {/* Row 3: Recent Activity + Email Volume Chart */}
        <Column lg={8} md={4} sm={4}>
          <Tile className="card">
            <div className="card__header">
              <h4 className="card__title">Recent Activity</h4>
            </div>
            <div className="card__content">
              <RecentActivity
                stats={stats}
                loading={loading}
                onEmailClick={handleEmailClick}
                onTaskClick={handleTaskClick}
              />
            </div>
          </Tile>
        </Column>
        <Column lg={8} md={4} sm={4}>
          <Tile className="card">
            <div className="card__content card__content--chart">
              <EmailVolumeChart data={stats?.charts.emailVolume} loading={loading} />
            </div>
          </Tile>
        </Column>

        {/* Row 4: Task Donut + Top Customers + Quick Add */}
        <Column lg={5} md={4} sm={4}>
          <Tile className="card">
            <div className="card__content card__content--chart">
              <TaskStatusDonut data={stats?.charts.taskStatusCounts} loading={loading} />
            </div>
          </Tile>
        </Column>
        <Column lg={6} md={4} sm={4}>
          <Tile className="card">
            <div className="card__header">
              <h4 className="card__title">Top Companies</h4>
            </div>
            <div className="card__content">
              <TopCustomers stats={stats} loading={loading} />
            </div>
          </Tile>
        </Column>
        <Column lg={5} md={4} sm={4}>
          <Tile className="card">
            <div className="card__header">
              <h4 className="card__title">Quick Add Task</h4>
            </div>
            <div className="card__content">
              <QuickAddTask onTaskCreated={fetchData} />
            </div>
          </Tile>
        </Column>

        {/* Row 5: Needs Attention + Frequent Contacts */}
        <Column lg={8} md={4} sm={4}>
          <Tile className="card">
            <div className="card__header">
              <h4 className="card__title">Needs Attention</h4>
            </div>
            <div className="card__content">
              <NeedsAttention customers={stats?.needsAttention} loading={loading} />
            </div>
          </Tile>
        </Column>
        <Column lg={8} md={4} sm={4}>
          <Tile className="card">
            <div className="card__header">
              <h4 className="card__title">Frequent Contacts</h4>
            </div>
            <div className="card__content">
              <FrequentContacts contacts={stats?.frequentContacts} loading={loading} />
            </div>
          </Tile>
        </Column>
      </Grid>

      {/* Email SidePanel */}
      <SidePanel
        open={!!selectedThread}
        onRequestClose={() => setSelectedThread(null)}
        title={selectedThread?.subject || 'Thread'}
        size="lg"
        className="mail-page__side-panel"
      >
        {selectedThread ? (
          <ThreadDetail
            threadId={selectedThread.id}
            onEmailAction={() => fetchData()}
          />
        ) : (
          <div />
        )}
      </SidePanel>

      {/* Task Detail Modal */}
      <TaskDetailModal
        task={editTask}
        open={!!editTask}
        onClose={() => setEditTask(null)}
        onUpdated={() => {
          fetchData();
          setEditTask(null);
        }}
        labels={labels}
      />

      {/* Event Detail Modal */}
      <EventDetailModal
        event={detailEvent}
        open={!!detailEvent}
        onClose={() => setDetailEvent(null)}
        onEdit={handleEventEdit}
        onDelete={handleEventDelete}
        onRespond={handleEventRespond}
      />
    </div>
  );
}
