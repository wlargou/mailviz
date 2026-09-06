import { describe, it, expect } from 'vitest';
import { getSummary } from './ActivityLogPage';

/**
 * The Details column. A task update's `from`/`to` are maps keyed by field
 * (from 1.12's describeTaskChanges); passed through String() they printed
 * "→ [object Object] · from [object Object]". An email's `to`/`from` are
 * still addresses and still print as such.
 */
const entry = (action: string, details: Record<string, unknown> | null) =>
  ({ id: 'a', action, entityType: 'task', entityId: 't', details, createdAt: '', status: 'success' }) as never;

describe('getSummary', () => {
  it('reads a task update as field: before → after, with dates formatted', () => {
    const s = getSummary(
      entry('TASK_UPDATED', {
        changes: ['status', 'remindAt'],
        from: { status: 'TO_DO', remindAt: null },
        to: { status: 'DONE', remindAt: '2026-09-05T08:00:00.000Z' },
      })
    );
    expect(s).toContain('status: TO_DO → DONE');
    expect(s).toMatch(/remindAt: — → Sep 5, 2026 \d{1,2}:\d{2} (AM|PM)/);
    expect(s).not.toContain('object Object');
  });

  it('still prints email addresses for a sent mail', () => {
    expect(getSummary(entry('EMAIL_SENT', { subject: 'Hi', to: ['a@x.test', 'b@x.test'], from: 'me@x.test' }))).toBe(
      '"Hi" · → a@x.test, b@x.test · from me@x.test'
    );
  });

  it('describes the 1.12 task actions', () => {
    expect(getSummary(entry('TASK_DEPENDENCY_ADDED', { blockerId: 'b', blocker: 'Sign the NDA' }))).toBe('blocked by "Sign the NDA"');
    expect(getSummary(entry('TASK_LINK_ADDED', { linkType: 'contact', linkId: 'c', label: 'Sam Lee' }))).toBe('contact: Sam Lee');
    expect(getSummary(entry('TASK_CHECKLIST_UPDATED', { added: 'Close the ticket' }))).toBe('added "Close the ticket"');
    expect(getSummary(entry('TASK_TIME_LOGGED', { minutes: 25, entryId: 'e', timer: true }))).toBe('25 min (timer)');
    expect(getSummary(entry('TASK_BATCH_STATUS', { count: 3, status: 'DONE', skipped: 0 }))).toBe('→ DONE · 3 items');
  });
});
