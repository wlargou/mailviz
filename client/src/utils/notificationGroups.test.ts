import { describe, it, expect } from 'vitest';
import { groupNotifications, notificationTarget, groupTarget, foldedTitle } from './notificationGroups';
import type { AppNotification } from '../api/notifications';

const NOW = new Date(2026, 8, 28, 15, 0);
let seq = 0;

function n(type: string, createdAt: Date, overrides: Partial<AppNotification> = {}): AppNotification {
  seq += 1;
  return {
    id: `n${seq}`,
    type,
    title: `${type} ${seq}`,
    message: null,
    entityType: null,
    entityId: null,
    isRead: false,
    isDismissed: false,
    createdAt: createdAt.toISOString(),
    ...overrides,
  };
}

const today = (h: number) => new Date(2026, 8, 28, h);
const yesterday = (h: number) => new Date(2026, 8, 27, h);
const lastWeek = new Date(2026, 8, 20, 9);

describe('groupNotifications', () => {
  it('sections by day, in order, leaving out empty ones', () => {
    const sections = groupNotifications([n('TASK_MENTIONED', today(9)), n('TASK_MENTIONED', lastWeek)], NOW);
    expect(sections.map((s) => s.label)).toEqual(['Today', 'Earlier']);
  });

  it('puts just after midnight in Today and just before it in Yesterday', () => {
    const sections = groupNotifications(
      [n('TASK_MENTIONED', new Date(2026, 8, 28, 0, 1)), n('TASK_MENTIONED', new Date(2026, 8, 27, 23, 59))],
      NOW,
    );
    expect(sections.map((s) => [s.label, s.rows.length])).toEqual([['Today', 1], ['Yesterday', 1]]);
  });

  it('puts the day before yesterday in Earlier', () => {
    const sections = groupNotifications([n('TASK_MENTIONED', new Date(2026, 8, 26, 23, 0))], NOW);
    expect(sections.map((s) => s.label)).toEqual(['Earlier']);
  });

  it('folds three of a type into one row, where the newest was', () => {
    const mention = n('TASK_MENTIONED', today(14));
    const overdue = [n('TASK_OVERDUE', today(13)), n('TASK_OVERDUE', today(8)), n('TASK_OVERDUE', today(7))];
    const [section] = groupNotifications([mention, overdue[0], overdue[1], overdue[2]], NOW);

    expect(section.rows).toHaveLength(2);
    expect(section.rows[0]).toMatchObject({ kind: 'single', notification: mention });
    expect(section.rows[1]).toMatchObject({ kind: 'group', type: 'TASK_OVERDUE', title: '3 tasks overdue' });
    expect(section.rows[1].kind === 'group' && section.rows[1].items.map((i) => i.id)).toEqual(overdue.map((o) => o.id));
  });

  it('leaves two of a type alone', () => {
    const [section] = groupNotifications([n('TASK_OVERDUE', today(9)), n('TASK_OVERDUE', today(8))], NOW);
    expect(section.rows.map((r) => r.kind)).toEqual(['single', 'single']);
  });

  it('never folds mentions — each names who wants what', () => {
    const [section] = groupNotifications(
      [n('TASK_MENTIONED', today(9)), n('TASK_MENTIONED', today(8)), n('TASK_MENTIONED', today(7))],
      NOW,
    );
    expect(section.rows.map((r) => r.kind)).toEqual(['single', 'single', 'single']);
  });

  it('folds only the day\u2019s own members into its group', () => {
    const todays = [n('TASK_OVERDUE', today(9)), n('TASK_OVERDUE', today(8)), n('TASK_OVERDUE', today(7))];
    const older = n('TASK_OVERDUE', yesterday(9));
    const [todaySection, yesterdaySection] = groupNotifications([...todays, older], NOW);
    const group = todaySection.rows[0];
    expect(group.kind === 'group' && group.items.map((i) => i.id)).toEqual(todays.map((t) => t.id));
    expect(yesterdaySection.rows).toEqual([{ kind: 'single', notification: older }]);
  });

  it('folds per day, not across days', () => {
    const sections = groupNotifications(
      [n('TASK_OVERDUE', today(9)), n('TASK_OVERDUE', today(8)), n('TASK_OVERDUE', yesterday(9)), n('TASK_OVERDUE', yesterday(8))],
      NOW,
    );
    expect(sections.flatMap((s) => s.rows.map((r) => r.kind))).toEqual(['single', 'single', 'single', 'single']);
  });
});

describe('where a notification leads', () => {
  it('opens the thing it is about', () => {
    expect(notificationTarget({ entityType: 'rfp', entityId: 'r1' })).toBe('/rfps/r1');
    expect(notificationTarget({ entityType: 'task', entityId: 't1' })).toBe('/tasks?task=t1');
    expect(notificationTarget({ entityType: 'email', entityId: 'th/1' })).toBe('/mail?folder=all&thread=th%2F1');
    expect(notificationTarget({ entityType: 'deal', entityId: 'd1' })).toBe('/deals');
    expect(notificationTarget({ entityType: null, entityId: null })).toBeNull();
  });

  it('opens overdue tasks as a filtered list', () => {
    expect(groupTarget('TASK_OVERDUE')).toBe('/tasks?overdue=true');
    expect(groupTarget('EVENT_STARTING')).toBe('/calendar');
    expect(groupTarget('SYSTEM')).toBeNull();
  });

  it('names a folded row by what it holds', () => {
    expect(foldedTitle('DEAL_EXPIRING', 4)).toBe('4 deals expiring');
    expect(foldedTitle('RFP_SHARED', 3)).toBe('3 items shared with you');
    expect(foldedTitle('SOMETHING_NEW', 5)).toBe('5 notifications');
  });
});
