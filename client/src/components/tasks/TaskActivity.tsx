import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, InlineLoading, Tag, TextArea } from '@carbon/react';
import { Edit, Send, TrashCan } from '@carbon/icons-react';
import { format, formatDistanceToNow } from 'date-fns';
import { tasksApi } from '../../api/tasks';
import { useAuthStore } from '../../store/authStore';
import { useUIStore } from '../../store/uiStore';
import { decodeEntities } from '../../utils/text';
import type { TaskActivityEntry, TaskActor, TaskStatusConfig } from '../../types/task';

interface MentionableUser {
  id: string;
  name: string | null;
  email: string;
}

interface TaskActivityProps {
  taskId: string;
  /** The task's owner may delete anyone's comment on it. */
  ownerId: string;
  users: MentionableUser[];
  /** To show a status change as its label, not its name. */
  statuses: TaskStatusConfig[];
  /**
   * Bumped by the panel whenever one of its sections writes — a subtask
   * ticked, a blocker added — so the timeline shows the event without a
   * reopen. The task's own `updatedAt` does not move for those.
   */
  version?: number;
}

/** What a user is called in an @mention: their name, or the local part of their email. */
function mentionLabel(u: { name: string | null; email: string }): string {
  return (u.name || u.email.split('@')[0]).trim();
}

function initials(actor: TaskActor): string {
  const source = actor.name || actor.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

/**
 * Where an @mention is being typed: the text after the last `@` before the
 * caret, provided it is at a word start and contains no whitespace.
 */
function mentionAtCaret(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

/**
 * A task's timeline: every change anyone made to it, and the comments.
 *
 * Comments are plain text with @mentions. Typing `@` opens a list of the
 * other users; picking one inserts `@Their Name` and remembers the id. On
 * submit the ids sent are those whose `@Name` is still in the text — delete
 * the name and the mention goes with it, so the server never notifies
 * someone the comment no longer addresses.
 */
export function TaskActivity({ taskId, ownerId, users, statuses, version = 0 }: TaskActivityProps) {
  const me = useAuthStore((s) => s.user?.id);
  const addNotification = useUIStore((s) => s.addNotification);
  const [entries, setEntries] = useState<TaskActivityEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  /** `@Label` → user id, for every mention inserted through the list. */
  const mentioned = useRef(new Map<string, string>());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggest, setSuggest] = useState<{ start: number; query: string; index: number } | null>(null);
  /**
   * Where the caret goes after a pick, applied in the commit that renders the
   * new body. A `requestAnimationFrame` did the same thing a frame later —
   * after a fast typist's next keystroke, which then landed at the old caret.
   */
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => {
    if (pendingCaret.current === null || !textareaRef.current) return;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(pos, pos);
  }, [body]);

  const load = useCallback(async () => {
    try {
      const { data: res } = await tasksApi.getActivity(taskId);
      setEntries(res.data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [taskId]);

  useEffect(() => {
    setEntries(null);
    setBody('');
    setEditing(null);
    mentioned.current.clear();
    void load();
  }, [load]);

  // A section wrote: re-read in place, keeping the draft and the list.
  const seenVersion = useRef(version);
  useEffect(() => {
    if (seenVersion.current === version) return;
    seenVersion.current = version;
    void load();
  }, [version, load]);

  const statusLabel = useCallback(
    (name: unknown) => statuses.find((s) => s.name === name)?.label ?? String(name ?? ''),
    [statuses]
  );

  const byLabel = useMemo(() => new Map(users.map((u) => [mentionLabel(u), u])), [users]);

  const candidates = useMemo(() => {
    if (!suggest) return [];
    const q = suggest.query.toLowerCase();
    return users
      .filter((u) => mentionLabel(u).toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, 6);
  }, [suggest, users]);

  /** The ids for the `@Name`s still present in a body. */
  const mentionsIn = (text: string): string[] => {
    const ids = new Set<string>();
    for (const [label, id] of mentioned.current) {
      if (text.includes(`@${label}`)) ids.add(id);
    }
    // Also names typed by hand that match a known user exactly.
    for (const [label, u] of byLabel) {
      if (text.includes(`@${label}`)) ids.add(u.id);
    }
    return [...ids];
  };

  const onBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setBody(value);
    const at = mentionAtCaret(value, e.target.selectionStart ?? value.length);
    setSuggest(at ? { ...at, index: 0 } : null);
  };

  const pick = (u: MentionableUser) => {
    if (!suggest) return;
    const label = mentionLabel(u);
    const caret = textareaRef.current?.selectionStart ?? body.length;
    const next = `${body.slice(0, suggest.start)}@${label} ${body.slice(caret)}`;
    mentioned.current.set(label, u.id);
    pendingCaret.current = suggest.start + label.length + 2;
    setBody(next);
    setSuggest(null);
  };

  const submit = async () => {
    const text = body.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      await tasksApi.addComment(taskId, { body: text, mentions: mentionsIn(text) });
      setBody('');
      mentioned.current.clear();
      await load();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to post comment' });
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const text = editing.body.trim();
    if (!text) return;
    try {
      await tasksApi.updateComment(taskId, editing.id, { body: text, mentions: mentionsIn(text) });
      setEditing(null);
      await load();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to edit comment' });
    }
  };

  const remove = async (id: string) => {
    try {
      await tasksApi.deleteComment(taskId, id);
      await load();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete comment' });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggest && candidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggest({ ...suggest, index: (suggest.index + 1) % candidates.length });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggest({ ...suggest, index: (suggest.index - 1 + candidates.length) % candidates.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(candidates[suggest.index]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSuggest(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  /** A comment body with each known `@Name` highlighted. */
  const renderBody = (text: string) => {
    const labels = [...byLabel.keys()].sort((a, b) => b.length - a.length);
    if (labels.length === 0) return text;
    const pattern = new RegExp(`@(${labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
    const out: React.ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(pattern)) {
      const i = m.index ?? 0;
      if (i > last) out.push(text.slice(last, i));
      out.push(<span key={i} className="task-activity__mention">{m[0]}</span>);
      last = i + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };

  return (
    <section className="task-section task-activity" aria-labelledby="task-activity-heading">
      <div className="task-section__header">
        <h4 id="task-activity-heading" className="task-section__title">Activity</h4>
        {entries && entries.length > 0 && (
          <span className="task-section__count">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
        )}
      </div>

      <div className="task-activity__composer">
        <TextArea
          ref={textareaRef}
          id="task-comment-body"
          labelText="Add a comment"
          hideLabel
          placeholder="Add a comment… type @ to mention someone"
          rows={2}
          value={body}
          onChange={onBodyChange}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setSuggest(null), 150)}
        />
        {suggest && candidates.length > 0 && (
          <ul className="task-activity__suggestions" role="listbox" aria-label="People to mention">
            {candidates.map((u, i) => (
              <li key={u.id} role="option" aria-selected={i === suggest.index}>
                <button
                  type="button"
                  className={`task-activity__suggestion${i === suggest.index ? ' task-activity__suggestion--active' : ''}`}
                  // mousedown, so the textarea's blur does not close the list first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(u);
                  }}
                >
                  <span>{mentionLabel(u)}</span>
                  <small>{u.email}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="task-activity__composer-actions">
          <Button size="sm" kind="primary" renderIcon={Send} disabled={!body.trim() || posting} onClick={() => void submit()}>
            Comment
          </Button>
        </div>
      </div>

      {entries === null && !failed && <InlineLoading description="Loading activity…" />}
      {failed && (
        <p className="task-activity__empty">
          Could not load the activity.{' '}
          <Button kind="ghost" size="sm" onClick={() => void load()}>Try again</Button>
        </p>
      )}
      {entries && entries.length === 0 && <p className="task-activity__empty">Nothing yet.</p>}

      {entries && entries.length > 0 && (
        <ul className="task-activity__list">
          {entries.map((entry) => {
            const who = entry.actor.name || entry.actor.email;
            const when = formatDistanceToNow(new Date(entry.at), { addSuffix: true });
            return (
              <li key={`${entry.kind}-${entry.id}`} className="task-activity__entry">
                <span className="task-activity__avatar" aria-hidden="true">
                  {entry.actor.avatarUrl ? <img src={entry.actor.avatarUrl} alt="" /> : initials(entry.actor)}
                </span>
                <div className="task-activity__body">
                  {entry.kind === 'comment' ? (
                    <>
                      <div className="task-activity__meta">
                        <strong>{who}</strong>
                        <time dateTime={entry.at} title={format(new Date(entry.at), 'PPpp')}>{when}</time>
                        {entry.editedAt && <span>(edited)</span>}
                      </div>
                      {editing?.id === entry.id ? (
                        <>
                          <TextArea
                            id={`edit-comment-${entry.id}`}
                            labelText="Edit comment"
                            hideLabel
                            rows={2}
                            value={editing.body}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                              setEditing({ id: entry.id, body: e.target.value })
                            }
                          />
                          <div className="task-activity__actions">
                            <Button size="sm" kind="primary" onClick={() => void saveEdit()} disabled={!editing.body.trim()}>
                              Save
                            </Button>
                            <Button size="sm" kind="ghost" onClick={() => setEditing(null)}>
                              Cancel
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="task-activity__text">{renderBody(entry.body)}</p>
                          {(entry.actor.id === me || ownerId === me) && (
                            <div className="task-activity__actions">
                              {entry.actor.id === me && (
                                <Button
                                  size="sm"
                                  kind="ghost"
                                  hasIconOnly
                                  renderIcon={Edit}
                                  iconDescription="Edit comment"
                                  onClick={() => setEditing({ id: entry.id, body: entry.body })}
                                />
                              )}
                              <Button
                                size="sm"
                                kind="danger--ghost"
                                hasIconOnly
                                renderIcon={TrashCan}
                                iconDescription="Delete comment"
                                onClick={() => void remove(entry.id)}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <div className="task-activity__meta">
                      <span className="task-activity__event">
                        <strong>{who}</strong> {describeEvent(entry.action, entry.details, statusLabel)}
                      </span>
                      <time dateTime={entry.at} title={format(new Date(entry.at), 'PPpp')}>{when}</time>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * An audit event as a sentence, minus the actor (rendered in bold before it).
 *
 * TASK_UPDATED carries `from` / `to` since 1.4; older rows only have
 * `changes`, and read "changed status" without the values.
 */
export function describeEvent(
  action: string,
  details: Record<string, unknown> | null,
  statusLabel: (name: unknown) => string
): React.ReactNode {
  const d = details ?? {};
  const to = (d.to ?? {}) as Record<string, unknown>;
  const from = (d.from ?? {}) as Record<string, unknown>;

  switch (action) {
    case 'TASK_CREATED':
      if (d.previousId) return 'created this task as the next occurrence of a repeating task';
      return d.parentId ? 'created this subtask' : 'created this task';
    case 'TASK_ASSIGNED':
      return to.assignedTo ? <>assigned this to <strong>{String(to.assignedTo)}</strong></> : 'unassigned this';
    case 'TASK_SHARED': {
      const n = Array.isArray(d.sharedWith) ? d.sharedWith.length : 0;
      return `shared this with ${n} ${n === 1 ? 'person' : 'people'}`;
    }
    case 'TASK_CHECKLIST_UPDATED':
      if (d.added) return <>added a checklist item: “{String(d.added)}”</>;
      if (d.removed) return 'removed a checklist item';
      return 'updated a checklist item';
    case 'TASK_DEPENDENCY_ADDED':
      return d.blocker ? <>marked this as blocked by <strong>{decodeEntities(String(d.blocker))}</strong></> : 'added a blocker';
    case 'TASK_DEPENDENCY_REMOVED':
      return 'removed a blocker';
    case 'TASK_UPDATED': {
      const changes = Array.isArray(d.changes) ? (d.changes as string[]) : [];
      const parts: React.ReactNode[] = [];
      for (const key of changes) {
        switch (key) {
          case 'title':
            parts.push(<>renamed this to “{decodeEntities(String(to.title ?? ''))}”</>);
            break;
          case 'status':
            parts.push(
              'status' in to ? (
                <>
                  moved this from <Tag size="sm" type="cool-gray">{statusLabel(from.status)}</Tag> to{' '}
                  <Tag size="sm" type="blue">{statusLabel(to.status)}</Tag>
                </>
              ) : 'changed the status'
            );
            break;
          case 'priority':
            parts.push('priority' in to ? <>set priority to <strong>{String(to.priority).toLowerCase()}</strong></> : 'changed the priority');
            break;
          case 'dueDate':
            parts.push(
              'dueDate' in to
                ? to.dueDate
                  ? <>set the due date to <strong>{format(new Date(String(to.dueDate)), 'MMM d, yyyy')}</strong></>
                  : 'cleared the due date'
                : 'changed the due date'
            );
            break;
          case 'startDate':
            parts.push(
              to.startDate
                ? <>set the start date to <strong>{format(new Date(String(to.startDate)), 'MMM d, yyyy')}</strong></>
                : 'cleared the start date'
            );
            break;
          case 'remindAt':
            parts.push(to.remindAt ? <>set a reminder for <strong>{format(new Date(String(to.remindAt)), 'MMM d, HH:mm')}</strong></> : 'removed the reminder');
            break;
          case 'customerId':
            parts.push(to.customer ? <>moved this to <strong>{String(to.customer)}</strong></> : 'removed the company');
            break;
          case 'parentId':
            parts.push(to.parent ? <>made this a subtask of <strong>{decodeEntities(String(to.parent))}</strong></> : 'detached this from its parent');
            break;
          case 'estimatedMinutes':
            parts.push(to.estimatedMinutes != null ? <>set the estimate to <strong>{String(to.estimatedMinutes)} min</strong></> : 'cleared the estimate');
            break;
          case 'description':
            parts.push('edited the description');
            break;
          case 'labelIds':
            parts.push('changed the labels');
            break;
          default:
            parts.push(`changed ${key}`);
        }
      }
      if (parts.length === 0) return 'updated this task';
      return parts.map((p, i) => (
        <span key={i}>
          {i > 0 && (i === parts.length - 1 ? ' and ' : ', ')}
          {p}
        </span>
      ));
    }
    default:
      return action.toLowerCase().replace(/^task_/, '').replace(/_/g, ' ');
  }
}
