import { useEffect, useRef, useState } from 'react';
import { Button, Search, Tag } from '@carbon/react';
import { Close, Email } from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { emailsApi } from '../../api/emails';
import { searchApi } from '../../api/search';
import { useUIStore } from '../../store/uiStore';
import { useTaskStore } from '../../store/taskStore';
import { decodeEntities } from '../../utils/text';
import { apiErrorMessage } from '../../utils/apiError';
import type { Task } from '../../types/task';

interface TaskEmailsProps {
  task: Task;
  onChanged: () => Promise<void> | void;
}

interface Candidate {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
}

/**
 * The emails a task was made from or attached to.
 *
 * Several, since 1.12: a thread with three asks in it is three tasks, and a
 * task may cite the request and the two follow-ups. Attaching searches mail
 * through the global search; a row opens Mail. Replies on these threads
 * appear on the timeline below.
 */
export function TaskEmails({ task, onChanged }: TaskEmailsProps) {
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const links = task.emailLinks ?? [];
  const linked = new Set(links.map((l) => l.email.id));

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setCandidates([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const { data: res } = await searchApi.search(q);
        setCandidates(
          res.data.emails
            .filter((e) => !linked.has(e.id))
            .map((e) => ({ id: e.id, subject: e.subject, from: e.fromName || e.from, receivedAt: e.receivedAt }))
        );
      } catch {
        setCandidates([]);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, links.length]);

  const attach = async (c: Candidate) => {
    try {
      await emailsApi.attachToTask(c.id, task.id);
      setQuery('');
      setCandidates([]);
      taskChanged();
      await onChanged();
    } catch (err) {
      addNotification({ kind: 'error', title: 'Could not attach the email', subtitle: apiErrorMessage(err, '') });
    }
  };

  const detach = async (emailId: string) => {
    try {
      await emailsApi.detachFromTask(emailId, task.id);
      taskChanged();
      await onChanged();
    } catch {
      addNotification({ kind: 'error', title: 'Could not detach the email' });
    }
  };

  return (
    <section className="task-section task-emails" aria-labelledby="task-emails-heading">
      <div className="task-section__header">
        <h4 id="task-emails-heading" className="task-section__title">Emails</h4>
        {links.length > 0 && <span className="task-section__count">{links.length}</span>}
      </div>

      {links.length > 0 && (
        <ul className="task-section__list">
          {links.map((l) => (
            <li key={l.id} className="task-section__item">
              <Tag size="sm" type={l.email.isArchived ? 'cool-gray' : 'blue'}>
                <span className="task-section__state" title={l.email.isArchived ? 'Archived' : 'In the inbox'}>
                  <Email size={12} aria-hidden="true" />
                </span>
              </Tag>
              <button
                type="button"
                className="task-section__text task-section__text--link"
                onClick={() => navigate('/mail')}
                title="Open in Mail"
              >
                {decodeEntities(l.email.subject)}
                <span className="task-section__meta">
                  {' '}· {decodeEntities(l.email.fromName || l.email.from)} · {format(new Date(l.email.receivedAt), 'MMM d')}
                </span>
                {l.conversionNote && <span className="task-section__meta"> · {decodeEntities(l.conversionNote)}</span>}
              </button>
              <Button
                kind="ghost"
                size="sm"
                hasIconOnly
                renderIcon={Close}
                iconDescription={`Detach: ${decodeEntities(l.email.subject)}`}
                className="task-section__remove"
                onClick={() => void detach(l.email.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="task-links__picker">
        <Search
          id="task-email-search"
          labelText="Attach an email"
          placeholder="Attach an email…"
          size="sm"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          onClear={() => setQuery('')}
        />
        {query.trim().length >= 2 && (
          <ul className="task-links__results" role="listbox" aria-label="Emails to attach">
            {candidates.length === 0 && <li className="task-links__none">No emails match.</li>}
            {candidates.map((c) => (
              <li key={c.id}>
                <button type="button" role="option" aria-selected={false} className="task-links__result" onClick={() => void attach(c)}>
                  <Email size={16} aria-hidden="true" className="task-links__result-icon" />
                  <span className="task-links__result-label">{decodeEntities(c.subject)}</span>
                  <small>{decodeEntities(c.from)} · {format(new Date(c.receivedAt), 'MMM d, yyyy')}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
