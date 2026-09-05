import { useEffect, useRef, useState } from 'react';
import { Button, Search, Tag } from '@carbon/react';
import { Calendar, Close, Partnership, User } from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { tasksApi } from '../../api/tasks';
import { searchApi, type SearchResults } from '../../api/search';
import { useUIStore } from '../../store/uiStore';
import { useTaskStore } from '../../store/taskStore';
import { decodeEntities } from '../../utils/text';
import { apiErrorMessage } from '../../utils/apiError';
import type { Task, TaskLink, TaskLinkType } from '../../types/task';

interface TaskLinksProps {
  task: Task;
  onChanged: () => Promise<void> | void;
}

interface Candidate {
  entityType: TaskLinkType;
  entityId: string;
  label: string;
  subtitle: string | null;
}

const ICON: Record<TaskLinkType, typeof User> = { contact: User, deal: Partnership, event: Calendar };
const NOUN: Record<TaskLinkType, string> = { contact: 'Contact', deal: 'Deal', event: 'Event' };

/** The global search's three record types, flattened into pickable rows. */
function candidatesFrom(results: SearchResults): Candidate[] {
  return [
    ...results.contacts.map((c) => ({
      entityType: 'contact' as const,
      entityId: c.id,
      label: `${c.firstName} ${c.lastName}`.trim() || c.email || 'Contact',
      subtitle: c.customer?.name ?? c.email ?? null,
    })),
    ...results.deals.map((d) => ({ entityType: 'deal' as const, entityId: d.id, label: d.title, subtitle: d.partner?.name ?? null })),
    ...results.events.map((e) => ({
      entityType: 'event' as const,
      entityId: e.id,
      label: e.title,
      subtitle: format(new Date(e.startTime), 'MMM d, HH:mm'),
    })),
  ];
}

/**
 * The contacts, deals and events a task is attached to.
 *
 * One search box feeds all three, through the global search endpoint, so
 * attaching a record is "type a few letters, pick a row" rather than choosing
 * a type first. Each row opens the record: a contact has a page, a deal its
 * list, an event the calendar on its day.
 */
export function TaskLinks({ task, onChanged }: TaskLinksProps) {
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);
  const taskChanged = useTaskStore((s) => s.taskChanged);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const links = task.links ?? [];
  const linked = new Set(links.map((l) => `${l.entityType}:${l.entityId}`));

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setCandidates([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data: res } = await searchApi.search(q);
        setCandidates(candidatesFrom(res.data).filter((c) => !linked.has(`${c.entityType}:${c.entityId}`)));
      } catch {
        setCandidates([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // `linked` is derived from props; re-searching when a link is added is
    // exactly what refreshes the candidate list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, links.length]);

  const add = async (c: Candidate) => {
    try {
      await tasksApi.addLink(task.id, c.entityType, c.entityId);
      setQuery('');
      setCandidates([]);
      taskChanged();
      await onChanged();
    } catch (err) {
      addNotification({ kind: 'error', title: 'Could not link the record', subtitle: apiErrorMessage(err, '') });
    }
  };

  const remove = async (l: TaskLink) => {
    try {
      await tasksApi.removeLink(task.id, l.entityType, l.entityId);
      taskChanged();
      await onChanged();
    } catch {
      addNotification({ kind: 'error', title: 'Could not remove the link' });
    }
  };

  const open = (l: TaskLink) => {
    switch (l.entityType) {
      case 'contact':
        navigate(`/contacts/${l.entityId}`);
        break;
      case 'deal':
        navigate('/deals');
        break;
      case 'event':
        navigate(l.when ? `/calendar?date=${format(new Date(l.when), 'yyyy-MM-dd')}` : '/calendar');
        break;
    }
  };

  return (
    <section className="task-section" aria-labelledby="task-links-heading">
      <div className="task-section__header">
        <h4 id="task-links-heading" className="task-section__title">Linked to</h4>
        {links.length > 0 && <span className="task-section__count">{links.length}</span>}
      </div>

      {links.length > 0 && (
        <ul className="task-section__list">
          {links.map((l) => {
            const Icon = ICON[l.entityType];
            return (
              <li key={`${l.entityType}:${l.entityId}`} className="task-section__item">
                <Tag size="sm" type="cool-gray">
                  <span className="task-section__state" title={NOUN[l.entityType]}>
                    <Icon size={12} aria-hidden="true" />
                  </span>
                </Tag>
                <button
                  type="button"
                  className="task-section__text task-section__text--link"
                  onClick={() => open(l)}
                  title={`Open ${NOUN[l.entityType].toLowerCase()}: ${decodeEntities(l.label)}`}
                >
                  {decodeEntities(l.label)}
                  {l.subtitle && <span className="task-section__meta"> · {decodeEntities(l.subtitle)}</span>}
                  {l.when && <span className="task-section__meta"> · {format(new Date(l.when), 'MMM d, HH:mm')}</span>}
                </button>
                <Button
                  kind="ghost"
                  size="sm"
                  hasIconOnly
                  renderIcon={Close}
                  iconDescription={`Unlink: ${decodeEntities(l.label)}`}
                  className="task-section__remove"
                  onClick={() => void remove(l)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <div className="task-links__picker">
        <Search
          id="task-link-search"
          labelText="Link a contact, deal or event"
          placeholder="Link a contact, deal or event…"
          size="sm"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          onClear={() => setQuery('')}
        />
        {query.trim().length >= 2 && (
          <ul className="task-links__results" role="listbox" aria-label="Records to link" aria-busy={searching}>
            {candidates.length === 0 && !searching && (
              <li className="task-links__none">No contacts, deals or events match.</li>
            )}
            {candidates.map((c) => {
              const Icon = ICON[c.entityType];
              return (
                <li key={`${c.entityType}:${c.entityId}`}>
                  {/* The button is the option: it is what takes the click and the focus. */}
                  <button type="button" role="option" aria-selected={false} className="task-links__result" onClick={() => void add(c)}>
                    <Icon size={16} aria-hidden="true" className="task-links__result-icon" />
                    <span className="task-links__result-label">{decodeEntities(c.label)}</span>
                    <small>{NOUN[c.entityType]}{c.subtitle ? ` · ${decodeEntities(c.subtitle)}` : ''}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
