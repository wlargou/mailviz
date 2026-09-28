import { describe, it, expect } from 'vitest';
import { actionLabel, entityTypeLabel, getSummary } from './ActivityLogPage';

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

describe('actionLabel', () => {
  it('names the RFP actions, which used to show as raw codes', () => {
    expect(actionLabel('RFP_DELETED')).toBe('RFP Deleted');
    expect(actionLabel('RFP_DOCUMENT_ADDED')).toBe('RFP Document Added');
  });

  it('spells out an action nobody labelled yet, rather than showing its code', () => {
    expect(actionLabel('RFP_LOT_ADDED')).toBe('RFP Lot Added');
    expect(actionLabel('CONTACT_VIP_TOGGLED')).toBe('Contact VIP Toggled');
    expect(actionLabel('SOMETHING_NEW')).not.toContain('_');
  });
});

describe('getSummary — RFP rows', () => {
  const rfp = (action: string, details: Record<string, unknown>) =>
    ({ id: 'a', action, entityType: 'rfp', entityId: 'r', details, createdAt: '', status: 'success' }) as never;

  it('names the tender, the file, the fields changed and who it was shared with', () => {
    expect(getSummary(rfp('RFP_CREATED', { reference: '70/AOO/BKAM/2026', lots: 1 }))).toContain('70/AOO/BKAM/2026');
    expect(getSummary(rfp('RFP_DOCUMENT_ADDED', { filename: 'CPS AO 70.pdf', kind: 'RFP' }))).toContain('CPS AO 70.pdf');
    expect(getSummary(rfp('RFP_UPDATED', { fields: ['status', 'deadlineAt'] }))).toContain('changed status, deadlineAt');
    expect(getSummary(rfp('RFP_SHARED', { sharedWith: ['u1', 'u2'] }))).toContain('with 2 people');
    expect(getSummary(rfp('RFP_UNSHARED', { recipientUserId: 'u1' }))).toBe('removed 1 person');
  });

  it('names the type as the filter does — RFP, not Rfp', () => {
    expect(entityTypeLabel('rfp')).toBe('RFP');
    expect(entityTypeLabel('scheduled_email')).toBe('Scheduled Email');
    expect(entityTypeLabel('workspace_item')).toBe('Workspace item');
  });
});
