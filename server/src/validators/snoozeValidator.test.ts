import { describe, it, expect } from 'vitest';
import { createReminderSchema } from './snoozeValidator.js';
import { REMINDER_KINDS } from '../services/snoozeService.js';

/**
 * Snooze / follow-up reminder requests.
 *
 * `remindAt` is checked here for shape only and re-checked against the clock in
 * the service — the split is deliberate and worth locking down, because it is
 * the sort of "duplicate validation" a later cleanup removes. What this schema
 * owes the service is a string `Date.parse` can read: `snoozeService` stores it
 * with `new Date(remindAt)`, and an unparseable value becomes `Invalid Date`,
 * which Prisma writes as null or rejects — either way the reminder never fires
 * and the thread stays hidden in the snoozed list forever.
 *
 * `kind` is bound to REMINDER_KINDS rather than a literal list so the schema
 * cannot drift away from the values the scheduler switches on.
 */

describe('createReminderSchema', () => {
  const valid = { threadId: 'thread-abc', kind: 'snooze', remindAt: '2026-09-01T09:00:00Z' };

  it('accepts a well formed reminder', () => {
    expect(createReminderSchema.parse(valid)).toEqual(valid);
  });

  it('requires all three fields', () => {
    expect(() => createReminderSchema.parse({ kind: 'snooze', remindAt: valid.remindAt })).toThrow();
    expect(() => createReminderSchema.parse({ threadId: 'thread-abc', remindAt: valid.remindAt })).toThrow();
    expect(() => createReminderSchema.parse({ threadId: 'thread-abc', kind: 'snooze' })).toThrow();
  });

  it('accepts exactly the kinds the scheduler knows about', () => {
    for (const kind of REMINDER_KINDS) {
      expect(createReminderSchema.parse({ ...valid, kind }).kind).toBe(kind);
    }

    // A kind the scheduler has no branch for would be stored and then never
    // acted on — a reminder that silently never fires.
    expect(() => createReminderSchema.parse({ ...valid, kind: 'reminder' })).toThrow();
    expect(() => createReminderSchema.parse({ ...valid, kind: 'SNOOZE' })).toThrow();
    expect(() => createReminderSchema.parse({ ...valid, kind: '' })).toThrow();
  });

  it('bounds threadId at 1..255 characters', () => {
    // Gmail thread ids are short hex strings; the bound is a sanity check on a
    // value used as a lookup key, not a format claim.
    expect(() => createReminderSchema.parse({ ...valid, threadId: '' })).toThrow();
    expect(createReminderSchema.parse({ ...valid, threadId: 'a'.repeat(255) }).threadId).toHaveLength(255);
    expect(() => createReminderSchema.parse({ ...valid, threadId: 'a'.repeat(256) })).toThrow();
  });

  it('rejects a remindAt no Date can read', () => {
    for (const remindAt of ['', 'tomorrow', 'not-a-date', '2026-13-45T00:00:00Z']) {
      expect(() => createReminderSchema.parse({ ...valid, remindAt }), `${JSON.stringify(remindAt)} should be rejected`)
        .toThrow();
    }
  });

  it('accepts an offset timestamp, not only the Z form', () => {
    // Deliberately `Date.parse`-based rather than `z.string().datetime()`,
    // which is UTC-only by default. A user in Paris snoozing to "tomorrow 9am"
    // may well send +02:00, and rejecting it would break snooze for them.
    const offset = '2026-09-01T09:00:00+02:00';

    expect(createReminderSchema.parse({ ...valid, remindAt: offset }).remindAt).toBe(offset);
  });

  it('names remindAt when it is the offending field', () => {
    const result = createReminderSchema.safeParse({ ...valid, remindAt: 'nope' });

    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('remindAt');
  });

  it('drops unknown keys — the owner is taken from the session, never the body', () => {
    const parsed = createReminderSchema.parse({ ...valid, userId: 'someone-else', firedAt: '2020-01-01T00:00:00Z' });

    expect(parsed).toEqual(valid);
  });
});
