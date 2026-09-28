import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActionableNotification, Button, MenuButton, MenuItem, SkeletonText, Tag } from '@carbon/react';
import { ArrowRight, Email as EmailIcon, TaskComplete, Calendar as CalendarIcon, Partnership, Document, Video } from '@carbon/icons-react';
import { SidePanel } from '@carbon/ibm-products';
import { format, formatDistanceStrict, differenceInCalendarDays } from 'date-fns';
import { PageHeader } from '../shared/PageHeader';
import { EmptyState } from '../shared/EmptyState';
import { PriorityBadge } from '../shared/PriorityBadge';
import { ReadyMeter } from '../rfps/RfpRisk';
import { ThreadDetail } from '../mail/ThreadDetail';
import { TaskDetailModal } from '../tasks/TaskDetailModal';
import { TaskCreateModal } from '../tasks/TaskCreateModal';
import { EventDetailModal } from '../calendar/EventDetailModal';
import { EventModal } from '../calendar/EventModal';
import { DealCreateModal } from '../deals/DealCreateModal';
import { MailComposeModal } from '../mail/MailComposeModal';
import { todayApi } from '../../api/today';
import { tasksApi } from '../../api/tasks';
import { taskStatusesApi } from '../../api/taskStatuses';
import { labelsApi } from '../../api/labels';
import { calendarApi } from '../../api/calendar';
import { useUIStore } from '../../store/uiStore';
import { useTaskStore } from '../../store/taskStore';
import { useTaskChanges } from '../../hooks/useTaskChanges';
import { useEmailWebSocket } from '../../hooks/useEmailWebSocket';
import { decodeEntities } from '../../utils/text';
import { timeLeft } from '../../utils/dates';
import { buildTimeline, todaySummary, WRAP_UP_HOUR, type TimelineItem } from '../../utils/today';
import type { Today } from '../../types/today';
import type { Label, Task, TaskStatusConfig } from '../../types/task';
import type { CalendarEvent } from '../../types/calendar';

/**
 * Today — the home page. One answer to "what needs me now".
 *
 * It replaces a Dashboard that summarised activity (charts, volumes, the
 * latest mail, ranked by recency) and a My Day that only knew about tasks.
 * Here the next meeting leads, with what to know walking in; then the day's
 * timeline — meetings, deadlines and due tasks in time order, with what is
 * already late gathered first; then who is waiting on a reply. The side rail
 * holds the stakes that span days. After the working day, the wrap-up leads.
 *
 * The charts live on at Insights.
 */

const SHAPE: Record<TimelineItem['kind'], string> = { meeting: 'meeting', deadline: 'deadline', task: 'task' };

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function waited(since: string, now: Date): string {
  const days = differenceInCalendarDays(now, new Date(since));
  if (days <= 0) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
}

export function TodayPage({ now: nowProp }: { now?: Date } = {}) {
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [today, setToday] = useState<Today | null>(null);
  const [failed, setFailed] = useState(false);
  const [statuses, setStatuses] = useState<TaskStatusConfig[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [thread, setThread] = useState<{ id: string; subject: string } | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [create, setCreate] = useState<null | 'task' | 'event' | 'deal' | 'mail'>(null);
  const now = useMemo(() => nowProp ?? new Date(), [nowProp, today]); // re-read the clock on each load

  const load = useCallback(async () => {
    try {
      const { data } = await todayApi.get();
      setToday(data.data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    taskStatusesApi.getAll().then(({ data }) => setStatuses(data.data)).catch(() => {});
    labelsApi.getAll().then(({ data }) => setLabels(data.data)).catch(() => {});
    // The day moves on its own: a meeting ends, a reply becomes owed.
    const timer = setInterval(() => void load(), 5 * 60_000);
    return () => clearInterval(timer);
  }, [load]);

  useTaskChanges(useCallback(() => { void load(); }, [load]));
  useEmailWebSocket(
    useMemo(() => ({
      'emails:synced': () => void load(),
      'email:sent': () => void load(),
      'calendar:synced': () => void load(),
    }), [load]),
    { onReconnect: () => void load() },
  );

  const doneStatus = statuses.find((s) => s.isTerminal)?.name ?? null;

  const finish = async (task: { id: string; title: string }) => {
    if (!doneStatus) return;
    try {
      await tasksApi.update(task.id, { status: doneStatus });
      addNotification({ kind: 'success', title: `“${decodeEntities(task.title)}” done` });
      taskChanged();
    } catch {
      addNotification({ kind: 'error', title: 'Could not finish the task' });
    }
  };

  /** Slipped work moves to tomorrow at the same hour, or 09:00 when it had none. */
  const moveToTomorrow = async (task: { id: string; title: string }, due: string | null) => {
    const next = due ? new Date(due) : new Date(now);
    const base = new Date(now);
    next.setFullYear(base.getFullYear(), base.getMonth(), base.getDate() + 1);
    if (!due || (next.getHours() === 0 && next.getMinutes() === 0)) next.setHours(9, 0, 0, 0);
    try {
      await tasksApi.update(task.id, { dueDate: next.toISOString() });
      addNotification({ kind: 'success', title: `“${decodeEntities(task.title)}” moved to tomorrow` });
      taskChanged();
    } catch {
      addNotification({ kind: 'error', title: 'Could not move the task' });
    }
  };

  const openEvent = async (id: string) => {
    try {
      const { data } = await calendarApi.getById(id);
      setEvent(data.data);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load event' });
    }
  };

  const openHref = (href: string) => navigate(href);

  const timeline = useMemo(() => (today ? buildTimeline(today, now) : null), [today, now]);
  const summary = useMemo(() => (today ? todaySummary(today, now) : null), [today, now]);
  const evening = now.getHours() >= WRAP_UP_HOUR;

  const createMenu = (
    <MenuButton label="Create" menuAlignment="bottom-end">
      <MenuItem label="New email" renderIcon={EmailIcon} onClick={() => setCreate('mail')} />
      <MenuItem label="New task" renderIcon={TaskComplete} onClick={() => setCreate('task')} />
      <MenuItem label="New event" renderIcon={CalendarIcon} onClick={() => setCreate('event')} />
      <MenuItem label="New RFP" renderIcon={Document} onClick={() => navigate('/rfps?new=1')} />
      <MenuItem label="New deal" renderIcon={Partnership} onClick={() => setCreate('deal')} />
    </MenuButton>
  );

  const subtitle = today && summary
    ? summary.parts.length > 0
      ? `${format(now, 'EEEE d MMMM')} · ${summary.parts.join(' · ')}`
      : `${format(now, 'EEEE d MMMM')} · nothing pressing`
    : format(now, 'EEEE d MMMM');

  const wrapUp = today && (
    <section className="today-card today-wrapup" aria-labelledby="today-wrapup">
      <h2 id="today-wrapup" className="today-card__label">Wrap-up</h2>
      <div className="today-wrapup__cols">
        <div>
          <h3 className="today-wrapup__head">Finished today · {today.wrapUp.finished.length}</h3>
          {today.wrapUp.finished.length === 0 ? (
            <p className="today-muted">Nothing marked done yet.</p>
          ) : (
            <ul className="today-plain">
              {today.wrapUp.finished.slice(0, 5).map((t) => <li key={t.id}>{decodeEntities(t.title)}</li>)}
            </ul>
          )}
        </div>
        <div>
          <h3 className="today-wrapup__head">Slipped · {today.wrapUp.slipped.length}</h3>
          {today.wrapUp.slipped.length === 0 ? (
            <p className="today-muted">Everything due today is done.</p>
          ) : (
            <ul className="today-plain">
              {today.tasks.dueToday.map((t) => (
                <li key={t.id} className="today-wrapup__slipped">
                  <span>{decodeEntities(t.title)}</span>
                  <Button kind="ghost" size="sm" onClick={() => void moveToTomorrow(t, t.dueDate)}>Move to tomorrow</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="today-wrapup__head">First tomorrow</h3>
          {today.wrapUp.tomorrow.length === 0 ? (
            <p className="today-muted">Nothing scheduled yet.</p>
          ) : (
            <ul className="today-plain">
              {today.wrapUp.tomorrow.map((t) => (
                <li key={`${t.kind}:${t.id}`}>
                  <span className="today-time">{format(new Date(t.at), 'HH:mm')}</span> {decodeEntities(t.title)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );

  return (
    <div className="today">
      <PageHeader
        title={today && summary && summary.count > 0 ? `${greeting(now)} — ${summary.count} ${summary.count === 1 ? 'thing needs' : 'things need'} you` : greeting(now)}
        subtitle={subtitle}
        actions={createMenu}
      />

      {failed && (
        <ActionableNotification
          inline
          kind="error"
          lowContrast
          hideCloseButton
          title="Could not load your day"
          subtitle="Showing nothing rather than something stale."
          actionButtonLabel="Try again"
          onActionButtonClick={() => void load()}
        />
      )}
      {!today && !failed && <SkeletonText paragraph lineCount={10} />}

      {today && timeline && (
        <div className="today-grid">
          <div className="today-main">
            {evening && wrapUp}

            {today.nextUp && (
              <section className="today-next" aria-labelledby="today-next">
                <span className="today-card__label" id="today-next">
                  {new Date(today.nextUp.event.startTime) <= now
                    ? 'Now'
                    : `Next · in ${formatDistanceStrict(new Date(today.nextUp.event.startTime), now, { roundingMethod: 'ceil' })}`}
                </span>
                <button type="button" className="today-next__title" onClick={() => void openEvent(today.nextUp!.event.id)}>
                  {decodeEntities(today.nextUp.event.title)}
                </button>
                <div className="today-next__meta">
                  <span>{format(new Date(today.nextUp.event.startTime), 'HH:mm')}–{format(new Date(today.nextUp.event.endTime), 'HH:mm')}</span>
                  {today.nextUp.event.location && <span>{today.nextUp.event.location}</span>}
                  {today.nextUp.prep.people.length > 0 && (
                    <span title={today.nextUp.prep.people.map((p) => p.name || p.email).join(', ')}>
                      {today.nextUp.prep.people.length} {today.nextUp.prep.people.length === 1 ? 'person' : 'people'}
                    </span>
                  )}
                  {today.nextUp.event.companies.map((c) => (
                    <Tag key={c.id} size="sm" type="blue" className="clickable-tag" onClick={() => navigate(`/customers/${c.id}`)}>{c.name}</Tag>
                  ))}
                </div>
                {today.nextUp.event.conferenceLink && (
                  <div className="today-next__actions">
                    <Button size="sm" renderIcon={Video} href={today.nextUp.event.conferenceLink} target="_blank" rel="noreferrer">
                      Join
                    </Button>
                  </div>
                )}
                {(today.nextUp.prep.recentThreads.length > 0 || today.nextUp.prep.openTasks.length > 0 || today.nextUp.prep.tenders.length > 0) && (
                  <div className="today-prep">
                    {today.nextUp.prep.recentThreads.length > 0 && (
                      <div>
                        <h3 className="today-prep__head">Last with them</h3>
                        <ul className="today-plain">
                          {today.nextUp.prep.recentThreads.map((t) => (
                            <li key={t.threadId ?? t.subject}>
                              <button
                                type="button"
                                className="today-link"
                                disabled={!t.threadId}
                                onClick={() => t.threadId && setThread({ id: t.threadId, subject: t.subject })}
                              >
                                {decodeEntities(t.subject) || '(No subject)'}
                              </button>
                              <span className="today-muted"> · {t.from} · {formatDistanceStrict(new Date(t.receivedAt), now, { addSuffix: true })}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(today.nextUp.prep.openTasks.length > 0 || today.nextUp.prep.tenders.length > 0) && (
                      <div>
                        <h3 className="today-prep__head">Open with them</h3>
                        <ul className="today-plain">
                          {today.nextUp.prep.tenders.map((r) => (
                            <li key={r.id}>
                              <button type="button" className="today-link" onClick={() => navigate(`/rfps/${r.id}`)}>{r.name}</button>
                              <span className="today-muted"> · tender · {timeLeft(r.deadlineAt, now)}</span>
                            </li>
                          ))}
                          {today.nextUp.prep.openTasks.map((t) => (
                            <li key={t.id}>
                              <button type="button" className="today-link" onClick={() => setTaskId(t.id)}>{decodeEntities(t.title)}</button>
                              {t.dueDate && <span className="today-muted"> · due {timeLeft(t.dueDate, now)}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            <section className="today-card" aria-labelledby="today-day">
              <h2 id="today-day" className="today-card__label">Your day</h2>
              {timeline.anytime.length === 0 && timeline.timed.length === 0 ? (
                <EmptyState title="Nothing dated today" description="No meetings, deadlines or tasks due." />
              ) : (
                <ol className="today-timeline">
                  {timeline.anytime.map((item) => item.kind === 'task' && (
                    <li key={`any:${item.id}`} className="today-row">
                      <span className="today-time">{item.late ? 'Late' : item.starts ? 'Starts' : 'Today'}</span>
                      <span className={`today-shape today-shape--${SHAPE[item.kind]}`} aria-hidden="true" />
                      <TaskLine item={item} doneStatus={doneStatus} onFinish={finish} onOpen={setTaskId} now={now} />
                    </li>
                  ))}
                  {(() => {
                    let nowDrawn = false;
                    return timeline.timed.flatMap((item) => {
                      const rows = [];
                      if (!nowDrawn && item.at && item.at > now) {
                        nowDrawn = true;
                        rows.push(<li key="now" className="today-now" aria-label={`Now, ${format(now, 'HH:mm')}`} />);
                      }
                      rows.push(
                        <li key={`${item.kind}:${item.id}`} className={`today-row${item.past ? ' today-row--past' : ''}`}>
                          <span className="today-time">{item.at ? format(item.at, 'HH:mm') : ''}</span>
                          <span className={`today-shape today-shape--${SHAPE[item.kind]}`} aria-hidden="true" />
                          {item.kind === 'task' ? (
                            <TaskLine item={item} doneStatus={doneStatus} onFinish={finish} onOpen={setTaskId} now={now} />
                          ) : item.kind === 'meeting' ? (
                            <span className="today-what">
                              <button type="button" className="today-link today-link--strong" onClick={() => void openEvent(item.id)}>
                                {decodeEntities(item.title)}
                              </button>
                              {item.context && <small>{item.context}</small>}
                            </span>
                          ) : (
                            <span className="today-what">
                              <button type="button" className="today-link today-link--strong" onClick={() => openHref(item.href)}>
                                {item.label}: {decodeEntities(item.title)}
                              </button>
                              {item.context && <small>{item.context}</small>}
                            </span>
                          )}
                          {item.kind === 'meeting' && item.link && !item.past && (
                            <Button kind="ghost" size="sm" href={item.link} target="_blank" rel="noreferrer">Join</Button>
                          )}
                        </li>,
                      );
                      return rows;
                    });
                  })()}
                </ol>
              )}
            </section>

            <section className="today-card" aria-labelledby="today-owed">
              <div className="today-card__top">
                <h2 id="today-owed" className="today-card__label">Waiting on your reply · {today.repliesOwed.length}</h2>
                {today.repliesOwed.length > 5 && (
                  <Button kind="ghost" size="sm" renderIcon={ArrowRight} onClick={() => navigate('/mail?folder=to-reply')}>All</Button>
                )}
              </div>
              {today.repliesOwed.length === 0 ? (
                <p className="today-muted">Nobody is waiting on you.</p>
              ) : (
                <ul className="today-list">
                  {today.repliesOwed.slice(0, 5).map((r) => (
                    <li key={r.threadId}>
                      <span className="today-shape today-shape--mail" aria-hidden="true" />
                      <span className="today-what">
                        <button type="button" className="today-link today-link--strong" onClick={() => setThread({ id: r.threadId, subject: r.subject })}>
                          {decodeEntities(r.subject) || '(No subject)'}
                        </button>
                        <small>{r.fromName || r.from}</small>
                      </span>
                      <span className="today-muted">{waited(r.receivedAt, now)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {!evening && today.wrapUp.finished.length > 0 && wrapUp}
          </div>

          <aside className="today-side" aria-label="What spans days">
            <section className="today-card" aria-labelledby="today-pursuits">
              <div className="today-card__top">
                <h2 id="today-pursuits" className="today-card__label">Pursuits closing</h2>
                <Button kind="ghost" size="sm" renderIcon={ArrowRight} onClick={() => navigate('/pursuits')}>All</Button>
              </div>
              {today.pursuits.length === 0 ? (
                <p className="today-muted">Nothing closes in the next two weeks.</p>
              ) : (
                <ul className="today-list">
                  {today.pursuits.map((p) => (
                    <li key={`${p.kind}:${p.id}`} className="today-stake">
                      <span className="today-what">
                        <button type="button" className="today-link today-link--strong" onClick={() => navigate(p.href)}>
                          {decodeEntities(p.title)}
                        </button>
                        <small>{[p.kind === 'RFP' ? 'Tender' : 'Deal registration', p.company, p.kind === 'DEAL' ? p.reference : null].filter(Boolean).join(' · ')}</small>
                        {p.readiness && p.readiness.total > 0 && <ReadyMeter readiness={p.readiness} />}
                      </span>
                      <span className="today-stake__when">
                        <Tag size="sm" type={p.atRisk || new Date(p.at) < now ? 'red' : 'cool-gray'}>
                          {p.atRisk ? `▲ ${timeLeft(p.at, now)}` : timeLeft(p.at, now)}
                        </Tag>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="today-card" aria-labelledby="today-waiting">
              <h2 id="today-waiting" className="today-card__label">Waiting on others</h2>
              {today.waitingOnOthers.length === 0 ? (
                <p className="today-muted">Nobody owes you an answer.</p>
              ) : (
                <ul className="today-list">
                  {today.waitingOnOthers.slice(0, 5).map((w) => (
                    <li key={w.threadId} className="today-stake">
                      <span className="today-what">
                        <button type="button" className="today-link" onClick={() => setThread({ id: w.threadId, subject: w.subject })}>
                          {decodeEntities(w.subject) || '(No subject)'}
                        </button>
                        <small>{w.to}</small>
                      </span>
                      <span className="today-muted">{waited(w.sentAt, now)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {today.quietAccounts.length > 0 && (
              <section className="today-card" aria-labelledby="today-quiet">
                <h2 id="today-quiet" className="today-card__label">Accounts going quiet</h2>
                <ul className="today-list">
                  {today.quietAccounts.slice(0, 5).map((a) => (
                    <li key={a.id} className="today-stake">
                      <span className="today-what">
                        <button type="button" className="today-link" onClick={() => navigate(`/customers/${a.id}`)}>{a.name}</button>
                        <small>{a.openWork} open · {a.lastTouchAt ? `last exchange ${format(new Date(a.lastTouchAt), 'd MMM')}` : 'no exchange yet'}</small>
                      </span>
                      <span className="today-muted">{a.lastTouchAt ? waited(a.lastTouchAt, now) : '—'}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <Button kind="ghost" size="sm" renderIcon={ArrowRight} onClick={() => navigate('/insights')}>
              Charts and volumes — Insights
            </Button>
          </aside>
        </div>
      )}

      <SidePanel selectorPrimaryFocus=".thread-detail"
        open={!!thread}
        onRequestClose={() => setThread(null)}
        title={decodeEntities(thread?.subject) || 'Thread'}
        size="lg"
        className="mail-page__side-panel"
      >
        {thread && <ThreadDetail threadId={thread.id} onEmailAction={() => void load()} />}
      </SidePanel>
      <TaskDetailModal
        taskId={taskId}
        open={!!taskId}
        onClose={() => setTaskId(null)}
        onUpdated={() => setTaskId(null)}
        onOpenTask={setTaskId}
        labels={labels}
      />
      {event && (
        <EventDetailModal
          event={event}
          open
          onClose={() => setEvent(null)}
          onEdit={() => { setEvent(null); navigate('/calendar'); }}
          onDelete={async (e, mode = 'single') => {
            try {
              await calendarApi.delete(e.id, mode);
              setEvent(null);
              void load();
            } catch {
              addNotification({ kind: 'error', title: 'Failed to delete event' });
            }
          }}
          onRespond={async (e, response) => {
            try {
              await calendarApi.respond(e.id, response);
              setEvent(null);
              void load();
            } catch {
              addNotification({ kind: 'error', title: 'Failed to respond' });
            }
          }}
        />
      )}
      <MailComposeModal open={create === 'mail'} onClose={() => setCreate(null)} onSent={() => setCreate(null)} mode="new" />
      <TaskCreateModal open={create === 'task'} onClose={() => setCreate(null)} onCreated={() => setCreate(null)} labels={labels} />
      <EventModal open={create === 'event'} onClose={() => setCreate(null)} onSaved={() => { setCreate(null); void load(); }} />
      <DealCreateModal open={create === 'deal'} onClose={() => setCreate(null)} onCreated={() => { setCreate(null); void load(); }} />
    </div>
  );
}

function TaskLine({
  item, doneStatus, onFinish, onOpen, now,
}: {
  item: Extract<TimelineItem, { kind: 'task' }>;
  doneStatus: string | null;
  onFinish: (t: Task) => void;
  onOpen: (id: string) => void;
  now: Date;
}) {
  const label = decodeEntities(item.title);
  return (
    <span className="today-what today-what--task">
      <input
        type="checkbox"
        className="today-check"
        checked={false}
        disabled={!doneStatus}
        aria-label={`Mark done: ${label}`}
        title={doneStatus ? undefined : 'No status is marked as finished. Set one in Settings.'}
        onChange={() => onFinish(item.task)}
      />
      <span>
        <button type="button" className="today-link today-link--strong" onClick={() => onOpen(item.id)}>{label}</button>
        <small>
          {[item.context, item.late && item.task.dueDate ? timeLeft(item.task.dueDate, now) : null].filter(Boolean).join(' · ')}
          {' '}<PriorityBadge priority={item.task.priority} />
        </small>
      </span>
    </span>
  );
}
