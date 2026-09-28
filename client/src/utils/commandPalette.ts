import type { SearchResults } from '../api/search';
import { decodeEntities } from './text';

/**
 * The command palette's list: search that acts.
 *
 * Typing "BKAM" should put the live tender first, then what you can do with
 * it, then the account and the rest — and messages last, because a record is
 * what you usually came for and mail is what you can already search in Mail.
 * With nothing typed it offers the pages and the create actions.
 */

export type PaletteGroup = 'Best match' | 'Do' | 'Go to' | 'Mail';

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  hint?: string;
  /** Where Enter takes you. */
  href: string;
}

export const PAGES: Array<{ label: string; href: string; words: string }> = [
  { label: 'Today', href: '/', words: 'today home dashboard my day' },
  { label: 'Mail', href: '/mail', words: 'mail inbox email' },
  { label: 'To reply', href: '/mail?folder=to-reply', words: 'reply replies owed waiting' },
  { label: 'Pursuits', href: '/pursuits', words: 'pursuits tenders rfp rfps deals' },
  { label: 'Tasks', href: '/tasks', words: 'tasks todo kanban' },
  { label: 'Calendar', href: '/calendar', words: 'calendar events meetings agenda' },
  { label: 'Companies', href: '/customers', words: 'companies accounts customers' },
  { label: 'Senders to review', href: '/customers', words: 'senders review triage' },
  { label: 'Contacts', href: '/contacts', words: 'contacts people' },
  { label: 'Insights', href: '/insights', words: 'insights charts dashboard stats' },
  { label: 'Activity log', href: '/activity', words: 'activity audit log history' },
  { label: 'Settings', href: '/settings', words: 'settings preferences' },
];

export const ACTIONS: Array<{ label: string; href: string; words: string }> = [
  { label: 'New task', href: '/tasks?new=1', words: 'new task create add todo' },
  { label: 'New email', href: '/mail?compose=1', words: 'new email compose write mail message' },
  { label: 'New event', href: '/calendar?new=1', words: 'new event meeting create schedule' },
  { label: 'New tender (RFP)', href: '/pursuits?tab=tenders&new=1', words: 'new rfp tender create register' },
  { label: 'New deal registration', href: '/pursuits?tab=deals', words: 'new deal registration create' },
];

function matches(words: string, q: string): boolean {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((t) => words.includes(t));
}

/** Records before messages: the order the list and "Best match" follow. */
function entities(results: SearchResults, now: Date): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const r of results.rfps ?? []) {
    const days = Math.ceil((new Date(r.deadlineAt).getTime() - now.getTime()) / 86_400_000);
    items.push({
      id: `rfp:${r.id}`, group: 'Go to', label: r.name, href: `/rfps/${r.id}`,
      hint: ['Tender', r.customer?.name, days >= 0 ? `due in ${days} ${days === 1 ? 'day' : 'days'}` : 'deadline passed'].filter(Boolean).join(' · '),
    });
  }
  for (const c of results.customers ?? []) {
    items.push({ id: `customer:${c.id}`, group: 'Go to', label: c.name, hint: 'Company', href: `/customers/${c.id}` });
  }
  for (const d of results.deals ?? []) {
    items.push({ id: `deal:${d.id}`, group: 'Go to', label: d.title, hint: ['Deal', d.partner?.name, d.customer?.name].filter(Boolean).join(' · '), href: '/pursuits?tab=deals' });
  }
  for (const c of results.contacts ?? []) {
    items.push({
      id: `contact:${c.id}`, group: 'Go to', label: decodeEntities(`${c.firstName} ${c.lastName}`).trim() || c.email || 'Contact',
      hint: ['Person', c.customer?.name].filter(Boolean).join(' · '), href: `/contacts/${c.id}`,
    });
  }
  for (const t of results.tasks ?? []) {
    items.push({ id: `task:${t.id}`, group: 'Go to', label: decodeEntities(t.title), hint: 'Task', href: `/tasks?task=${t.id}` });
  }
  // A recurring meeting comes back once per occurrence; one row is enough.
  const meetings = new Set<string>();
  for (const e of results.events ?? []) {
    if (meetings.has(e.title)) continue;
    meetings.add(e.title);
    items.push({ id: `event:${e.id}`, group: 'Go to', label: e.title, hint: 'Meeting', href: '/calendar' });
  }
  return items;
}

export function paletteItems(query: string, results: SearchResults | null, now = new Date()): PaletteItem[] {
  const q = query.trim();
  if (!q) {
    return [
      ...ACTIONS.map((a) => ({ id: `do:${a.label}`, group: 'Do' as const, label: a.label, href: a.href })),
      ...PAGES.map((p) => ({ id: `page:${p.label}`, group: 'Go to' as const, label: p.label, hint: 'Page', href: p.href })),
    ];
  }

  const records = results ? entities(results, now) : [];
  const [best, ...rest] = records;
  const items: PaletteItem[] = [];
  if (best) items.push({ ...best, group: 'Best match' });

  // What you can do: the create actions whose words match, and — when the
  // best match is a company or a tender — work for it.
  const actions: PaletteItem[] = ACTIONS.filter((a) => matches(a.words, q)).map((a) => ({
    id: `do:${a.label}`, group: 'Do', label: a.label, href: a.href,
  }));
  if (best?.id.startsWith('customer:')) {
    const id = best.id.slice('customer:'.length);
    actions.unshift({ id: `do:task-for:${id}`, group: 'Do', label: `New task for ${best.label}`, href: `/tasks?new=1&customer=${id}` });
  }
  if (best?.id.startsWith('rfp:')) {
    actions.unshift({ id: `do:rfp-pieces:${best.id}`, group: 'Do', label: `Prepare the pieces of ${best.label}`, href: best.href });
  }
  items.push(...actions);

  items.push(...PAGES.filter((p) => matches(p.words, q)).map((p) => ({
    id: `page:${p.label}`, group: 'Go to' as const, label: p.label, hint: 'Page', href: p.href,
  })));
  items.push(...rest);

  for (const m of results?.emails ?? []) {
    items.push({
      id: `mail:${m.id}`, group: 'Mail', label: decodeEntities(m.subject) || '(No subject)',
      hint: decodeEntities(m.fromName || m.from),
      href: m.threadId ? `/mail?folder=all&thread=${encodeURIComponent(m.threadId)}` : '/mail',
    });
  }
  return items;
}
