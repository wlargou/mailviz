import type { AppNotification } from '../api/notifications';

/**
 * The notification panel, grouped.
 *
 * It was one flat list, newest first, and the overdue sweep writes one row
 * per task — so a bad morning was twelve identical "Task overdue" rows above
 * the one mention that mattered. Two things fix that:
 *
 *  - Sections by day (Today, Yesterday, Earlier), so the age of a row is
 *    visible without reading each timestamp.
 *  - Within a section, three or more of the same type fold into one row
 *    ("12 tasks overdue") that opens to show them.
 *
 * Mentions, comments, assignments and shares never fold: each names a person
 * and a thing, and folding them would hide who wants what.
 */

export const FOLD_AT = 3;

const NEVER_FOLD = new Set(['TASK_MENTIONED', 'TASK_COMMENTED', 'TASK_ASSIGNED', 'SYSTEM']);

/** "12 tasks overdue" — the folded row's title, per type. */
const FOLDED_TITLE: Record<string, (n: number) => string> = {
  TASK_OVERDUE: (n) => `${n} tasks overdue`,
  TASK_DUE_SOON: (n) => `${n} tasks due soon`,
  TASK_REMINDER: (n) => `${n} task reminders`,
  EVENT_STARTING: (n) => `${n} events starting`,
  DEAL_EXPIRING: (n) => `${n} deals expiring`,
  DEAL_EXPIRED: (n) => `${n} deals expired`,
};

export function foldedTitle(type: string, n: number): string {
  const known = FOLDED_TITLE[type];
  if (known) return known(n);
  if (type.endsWith('_SHARED')) return `${n} items shared with you`;
  return `${n} notifications`;
}

export type PanelRow =
  | { kind: 'single'; notification: AppNotification }
  | { kind: 'group'; key: string; type: string; title: string; items: AppNotification[] };

export interface PanelSection {
  label: 'Today' | 'Yesterday' | 'Earlier';
  rows: PanelRow[];
}

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function sectionOf(createdAt: string, now: Date): PanelSection['label'] {
  const today = dayStart(now);
  const at = new Date(createdAt).getTime();
  if (at >= today) return 'Today';
  if (at >= today - 86_400_000) return 'Yesterday';
  return 'Earlier';
}

/**
 * Sections in order, rows in the input's order (the server sends newest
 * first). A folded group takes the place of its newest member.
 */
export function groupNotifications(list: AppNotification[], now = new Date()): PanelSection[] {
  const order: PanelSection['label'][] = ['Today', 'Yesterday', 'Earlier'];
  const bySection = new Map<PanelSection['label'], AppNotification[]>();
  for (const n of list) {
    const label = sectionOf(n.createdAt, now);
    bySection.set(label, [...(bySection.get(label) ?? []), n]);
  }

  const sections: PanelSection[] = [];
  for (const label of order) {
    const items = bySection.get(label);
    if (!items?.length) continue;

    const countByType = new Map<string, number>();
    for (const n of items) countByType.set(n.type, (countByType.get(n.type) ?? 0) + 1);
    const folds = (type: string) => !NEVER_FOLD.has(type) && (countByType.get(type) ?? 0) >= FOLD_AT;

    const rows: PanelRow[] = [];
    const placed = new Set<string>();
    for (const n of items) {
      if (!folds(n.type)) {
        rows.push({ kind: 'single', notification: n });
      } else if (!placed.has(n.type)) {
        placed.add(n.type);
        const members = items.filter((m) => m.type === n.type);
        rows.push({
          kind: 'group',
          key: `${label}:${n.type}`,
          type: n.type,
          title: foldedTitle(n.type, members.length),
          items: members,
        });
      }
    }
    sections.push({ label, rows });
  }
  return sections;
}

/** Where a notification leads — `null` when it names nothing to open. */
export function notificationTarget(n: Pick<AppNotification, 'entityType' | 'entityId'>): string | null {
  switch (n.entityType) {
    case 'task':
      // Straight to the task's panel when the notification names one —
      // a mention or a comment is about a specific task, not the list.
      return n.entityId ? `/tasks?task=${n.entityId}` : '/tasks';
    case 'rfp':
      return n.entityId ? `/rfps/${n.entityId}` : '/rfps';
    case 'email':
      // The id is a thread; a shared one is not in the inbox, so open All.
      return n.entityId ? `/mail?folder=all&thread=${encodeURIComponent(n.entityId)}` : '/mail';
    case 'deal':
      return '/deals';
    case 'event':
      return '/calendar';
    default:
      return null;
  }
}

/** Where a folded group leads: the list the items belong to. */
export function groupTarget(type: string): string | null {
  if (type === 'TASK_OVERDUE') return '/tasks?overdue=true';
  if (type.startsWith('TASK')) return '/tasks';
  if (type.startsWith('DEAL')) return '/deals';
  if (type.startsWith('EVENT')) return '/calendar';
  return null;
}
