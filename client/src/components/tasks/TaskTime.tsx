import { useEffect, useState } from 'react';
import { Button, NumberInput, ProgressBar, TextInput } from '@carbon/react';
import { Add, PauseFilled, PlayFilledAlt, TrashCan } from '@carbon/icons-react';
import { format, formatDistanceToNow } from 'date-fns';
import { tasksApi } from '../../api/tasks';
import { useAuthStore } from '../../store/authStore';
import { useUIStore } from '../../store/uiStore';
import { useTaskStore } from '../../store/taskStore';
import { apiError, apiErrorMessage } from '../../utils/apiError';
import type { Task } from '../../types/task';

interface TaskTimeProps {
  task: Task;
  onChanged: () => Promise<void> | void;
}

/** `90` reads as `1h 30m`; `0` as `0m`. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** A running timer's elapsed time as mm:ss or h:mm:ss, ticking. */
function useElapsed(since: string | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  if (!since) return '';
  const total = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Time spent on a task: a timer, a manual log, and the entries.
 *
 * The timer is one row with no end; stopping it writes the minutes. One
 * runs per person across all tasks, and the server names the other task
 * when a second start is refused — so the message here is the server's.
 * The total counts finished entries only, and is drawn against the estimate
 * when there is one, which is the number the estimate was waiting for.
 */
export function TaskTime({ task, onChanged }: TaskTimeProps) {
  const me = useAuthStore((s) => s.user?.id);
  const addNotification = useUIStore((s) => s.addNotification);
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [minutes, setMinutes] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const running = task.runningEntry ?? null;
  const elapsed = useElapsed(running?.startedAt ?? null);
  const entries = task.timeEntries ?? [];
  const tracked = task.trackedMinutes ?? 0;
  const estimate = task.estimatedMinutes ?? 0;

  const call = async (fn: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try {
      await fn();
      taskChanged();
      await onChanged();
    } catch (err) {
      const refusal = apiError(err);
      addNotification({
        kind: refusal.code === 'TIMER_RUNNING' ? 'warning' : 'error',
        title: refusal.code === 'TIMER_RUNNING' ? 'Another timer is running' : failure,
        subtitle: apiErrorMessage(err, ''),
      });
    } finally {
      setBusy(false);
    }
  };

  const log = () => {
    if (typeof minutes !== 'number' || minutes < 1) return;
    void call(async () => {
      await tasksApi.logTime(task.id, { minutes, note: note.trim() || undefined });
      setMinutes('');
      setNote('');
    }, 'Could not log the time');
  };

  return (
    <section className="task-section task-time" aria-labelledby="task-time-heading">
      <div className="task-section__header">
        <h4 id="task-time-heading" className="task-section__title">Time</h4>
        <span className="task-section__count">
          {formatMinutes(tracked)} tracked{estimate > 0 ? ` · ${formatMinutes(estimate)} estimated` : ''}
        </span>
      </div>

      {estimate > 0 && (
        <ProgressBar
          label="Tracked against the estimate"
          hideLabel
          size="small"
          value={Math.min(tracked, estimate)}
          max={estimate}
          status={tracked > estimate ? 'error' : tracked === estimate ? 'finished' : 'active'}
          helperText={tracked > estimate ? `${formatMinutes(tracked - estimate)} over the estimate` : undefined}
          className="task-section__progress"
        />
      )}

      <div className="task-time__timer">
        {running ? (
          <>
            <span className="task-time__elapsed" aria-live="off" title={`Started ${format(new Date(running.startedAt), 'PPp')}`}>
              {elapsed}
            </span>
            <Button size="sm" kind="secondary" renderIcon={PauseFilled} disabled={busy} onClick={() => void call(() => tasksApi.stopTimer(task.id), 'Could not stop the timer')}>
              Stop
            </Button>
          </>
        ) : (
          <Button size="sm" kind="tertiary" renderIcon={PlayFilledAlt} disabled={busy} onClick={() => void call(() => tasksApi.startTimer(task.id), 'Could not start the timer')}>
            Start timer
          </Button>
        )}
      </div>

      <div className="task-time__log">
        <NumberInput
          id="task-time-minutes"
          label="Minutes"
          hideLabel
          size="sm"
          min={1}
          max={1440}
          step={15}
          placeholder="Minutes"
          value={minutes}
          allowEmpty
          onChange={(_e, { value }) => setMinutes(value === '' || value === undefined ? '' : Number(value))}
        />
        <TextInput
          id="task-time-note"
          labelText="Note"
          hideLabel
          size="sm"
          placeholder="What was it for? (optional)"
          value={note}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              log();
            }
          }}
        />
        <Button size="sm" kind="ghost" hasIconOnly renderIcon={Add} iconDescription="Log time" disabled={busy || typeof minutes !== 'number' || minutes < 1} onClick={log} />
      </div>

      {entries.length > 0 && (
        <ul className="task-section__list">
          {entries.map((e) => {
            const who = e.user?.name || e.user?.email || 'Someone';
            const mine = e.userId === me;
            return (
              <li key={e.id} className="task-section__item">
                <span className="task-time__minutes">{e.endedAt ? formatMinutes(e.minutes) : 'running'}</span>
                <span className="task-section__text">
                  {e.note ? e.note : e.endedAt ? 'Logged' : 'Timer'}
                  <span className="task-section__meta"> · {who} · {formatDistanceToNow(new Date(e.startedAt), { addSuffix: true })}</span>
                </span>
                {e.endedAt && (mine || task.userId === me) && (
                  <Button
                    kind="danger--ghost"
                    size="sm"
                    hasIconOnly
                    renderIcon={TrashCan}
                    iconDescription={`Delete ${formatMinutes(e.minutes)} entry`}
                    className="task-section__remove"
                    onClick={() => void call(() => tasksApi.deleteTimeEntry(task.id, e.id), 'Could not delete the entry')}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
