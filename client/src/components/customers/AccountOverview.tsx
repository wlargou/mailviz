import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, InlineLoading, SkeletonText, Tag } from '@carbon/react';
import { differenceInCalendarDays, format } from 'date-fns';
import { accountsApi, type AccountOverview as Overview, type AccountTimelineEntry } from '../../api/customers';
import { PriorityBadge } from '../shared/PriorityBadge';
import { decodeEntities } from '../../utils/text';
import { timeLeft } from '../../utils/dates';

/**
 * How we are doing with this customer, in five seconds: the relationship
 * (last touch and twelve weeks of rhythm), what is open with them, and the
 * people who matter there — ranked by exchanges, not by the first letter of
 * a generated name.
 */

export type Warmth = 'Active' | 'Cooling' | 'Quiet' | 'No exchange yet';

/** Active within two weeks, cooling within five, quiet after that. */
export function warmthOf(lastTouchAt: string | null, now = new Date()): Warmth {
  if (!lastTouchAt) return 'No exchange yet';
  const days = differenceInCalendarDays(now, new Date(lastTouchAt));
  if (days <= 14) return 'Active';
  if (days <= 35) return 'Cooling';
  return 'Quiet';
}

const WARMTH_TAG: Record<Warmth, 'green' | 'warm-gray' | 'red' | 'cool-gray'> = {
  Active: 'green',
  Cooling: 'warm-gray',
  Quiet: 'red',
  'No exchange yet': 'cool-gray',
};

function ago(iso: string, now: Date): string {
  const d = differenceInCalendarDays(now, new Date(iso));
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

interface Props {
  customerId: string;
  onOpenTask: (id: string) => void;
  now?: Date;
}

export function AccountOverview({ customerId, onOpenTask, now = new Date() }: Props) {
  const navigate = useNavigate();
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    accountsApi.overview(customerId)
      .then(({ data: res }) => { if (live) setData(res.data); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [customerId]);

  if (failed) return null;
  if (!data) return <div className="account-overview"><SkeletonText paragraph lineCount={4} /></div>;

  const warmth = warmthOf(data.lastTouchAt, now);
  const peak = Math.max(1, ...data.weekly.map((w) => w.emails + w.meetings));
  const nothingOpen = data.open.taskCount === 0 && data.open.tenders.length === 0 && data.open.deals.length === 0;

  return (
    <div className="account-overview">
      <section className="account-card" aria-labelledby="account-relationship">
        <h2 id="account-relationship" className="account-card__label">Relationship</h2>
        <div className="account-warmth">
          <Tag type={WARMTH_TAG[warmth]} size="md">{warmth}</Tag>
          {data.lastTouchAt && <span className="account-muted">last exchange {ago(data.lastTouchAt, now)}</span>}
        </div>
        <div className="account-rhythm" role="img" aria-label={`Mail and meetings per week, last ${data.weekly.length} weeks`}>
          {data.weekly.map((w) => {
            const n = w.emails + w.meetings;
            return (
              <span
                key={w.weekStart}
                className={`account-rhythm__bar${n === 0 ? ' account-rhythm__bar--empty' : ''}`}
                style={{ height: `${Math.max(6, Math.round((n / peak) * 100))}%` }}
                title={`Week of ${format(new Date(w.weekStart), 'd MMM')}: ${w.emails} emails, ${w.meetings} meetings`}
              />
            );
          })}
        </div>
        <span className="account-muted">{data.weekly.length} weeks · mail and meetings</span>
      </section>

      <section className="account-card" aria-labelledby="account-open">
        <h2 id="account-open" className="account-card__label">Open with them</h2>
        {nothingOpen ? (
          <p className="account-muted">Nothing open — no task, tender or deal.</p>
        ) : (
          <ul className="account-list">
            {data.open.tenders.map((r) => (
              <li key={`r:${r.id}`}>
                <button type="button" className="today-link today-link--strong" onClick={() => navigate(`/rfps/${r.id}`)}>{r.name}</button>
                <Tag size="sm" type={new Date(r.deadlineAt) < now ? 'red' : 'cool-gray'}>tender · {timeLeft(r.deadlineAt, now)}</Tag>
              </li>
            ))}
            {data.open.deals.map((d) => (
              <li key={`d:${d.id}`}>
                <button type="button" className="today-link today-link--strong" onClick={() => navigate('/pursuits?tab=deals')}>{d.title}</button>
                <Tag size="sm" type="cool-gray">{d.expiryDate ? `deal · ${timeLeft(d.expiryDate, now)}` : 'deal'}</Tag>
              </li>
            ))}
            {data.open.tasks.map((t) => (
              <li key={`t:${t.id}`}>
                <button type="button" className="today-link" onClick={() => onOpenTask(t.id)}>{decodeEntities(t.title)}</button>
                <span className="account-muted">
                  <PriorityBadge priority={t.priority} />
                  {t.dueDate && ` · due ${timeLeft(t.dueDate, now)}`}
                </span>
              </li>
            ))}
            {data.open.taskCount > data.open.tasks.length && (
              <li className="account-muted">+ {data.open.taskCount - data.open.tasks.length} more tasks</li>
            )}
          </ul>
        )}
      </section>

      <section className="account-card" aria-labelledby="account-people">
        <h2 id="account-people" className="account-card__label">People who matter</h2>
        {data.keyPeople.length === 0 ? (
          <p className="account-muted">No exchanges with anyone here yet.</p>
        ) : (
          <ul className="account-list">
            {data.keyPeople.map((p) => (
              <li key={p.id}>
                <span className="account-person">
                  <button type="button" className="today-link today-link--strong" onClick={() => navigate(`/contacts/${p.id}`)}>
                    {p.name || p.email}
                  </button>
                  <small className="account-muted">{[p.role, p.lastAt ? `last ${ago(p.lastAt, now)}` : null].filter(Boolean).join(' · ')}</small>
                </span>
                <Tag size="sm" type="cool-gray" title={`${p.exchanges} emails exchanged`}>{p.exchanges}</Tag>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const KIND_LABEL: Record<AccountTimelineEntry['kind'], string> = {
  THREAD: 'Mail',
  MEETING: 'Meeting',
  TASK: 'Task',
  TENDER: 'Tender',
  DEAL: 'Deal',
};

/**
 * Everything that happened with the account, newest first: mail threads,
 * meetings, tasks, tenders and deals interleaved, a page at a time.
 */
export function AccountTimeline({
  customerId, onOpenThread, onOpenTask,
}: {
  customerId: string;
  onOpenThread: (threadId: string, subject: string) => void;
  onOpenTask: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<AccountTimelineEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (before?: string) => {
    const { data: res } = await accountsApi.timeline(customerId, before);
    setEntries((prev) => (before && prev ? [...prev, ...res.data.entries] : res.data.entries));
    setNext(res.data.nextBefore);
  }, [customerId]);

  useEffect(() => {
    setEntries(null);
    load().catch(() => setEntries([]));
  }, [load]);

  if (!entries) return <SkeletonText paragraph lineCount={6} />;
  if (entries.length === 0) return <p className="account-muted">Nothing has happened with this account yet.</p>;

  const open = (e: AccountTimelineEntry) => {
    if (e.kind === 'THREAD' && e.threadId) onOpenThread(e.threadId, e.title);
    else if (e.kind === 'TASK') onOpenTask(e.id);
    else if (e.kind === 'TENDER') navigate(`/rfps/${e.id}`);
    else if (e.kind === 'DEAL') navigate('/pursuits?tab=deals');
    else if (e.kind === 'MEETING') navigate('/calendar');
  };

  let lastDay = '';
  return (
    <div className="account-timeline">
      <ol className="account-timeline__list">
        {entries.map((e) => {
          const day = format(new Date(e.at), 'EEEE d MMMM yyyy');
          const heading = day !== lastDay ? day : null;
          lastDay = day;
          return (
            <li key={`${e.kind}:${e.id}`}>
              {heading && <h3 className="account-timeline__day">{heading}</h3>}
              <div className="account-timeline__row">
                <span className="today-time">{format(new Date(e.at), 'HH:mm')}</span>
                <span className={`today-shape today-shape--${e.kind === 'THREAD' ? 'mail' : e.kind === 'MEETING' ? 'meeting' : e.kind === 'TASK' ? 'task' : 'deadline'}`} aria-hidden="true" />
                <span className="today-what">
                  <button type="button" className="today-link today-link--strong" onClick={() => open(e)}>
                    {decodeEntities(e.title) || '(No subject)'}
                  </button>
                  <small>{[KIND_LABEL[e.kind], e.detail].filter(Boolean).join(' · ')}</small>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {next && (
        <Button
          kind="ghost"
          size="sm"
          disabled={loadingMore}
          onClick={async () => {
            setLoadingMore(true);
            try { await load(next); } finally { setLoadingMore(false); }
          }}
        >
          {loadingMore ? <InlineLoading description="Loading…" /> : 'Show older'}
        </Button>
      )}
    </div>
  );
}
