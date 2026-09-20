import { describe, it, expect } from 'vitest';
import { convertToTaskSchema } from './emailValidator.js';

/**
 * "Convert this email into a task".
 *
 * Every field is optional because the modal is allowed to send nothing at all —
 * the service falls back to the email's own subject for the title. That makes
 * the two things worth asserting: an empty body must parse (otherwise the
 * one-click conversion 400s), and `priority` must stay an enum, because it is
 * written to a Prisma enum column where an unexpected value is a P2009 crash
 * reported as a 500 rather than the 400 it is.
 *
 * Since the convert form gained every task field, the schema is built from
 * `createTaskSchema`. The tests below that name task fields (status, due date,
 * labels, estimate) exist to prove that derivation holds — that the convert
 * schema does not quietly become a hand-copied subset again.
 */

describe('convertToTaskSchema', () => {
  it('accepts an empty body — the modal may send nothing', () => {
    expect(convertToTaskSchema.parse({})).toEqual({});
  });

  it('accepts a fully specified conversion', () => {
    const input = { title: 'Reply to Ada', priority: 'HIGH', notes: 'Before Friday' };

    expect(convertToTaskSchema.parse(input)).toEqual(input);
  });

  it('accepts only the four priorities', () => {
    for (const priority of ['LOW', 'MEDIUM', 'HIGH', 'URGENT']) {
      expect(convertToTaskSchema.parse({ priority }).priority).toBe(priority);
    }

    expect(() => convertToTaskSchema.parse({ priority: 'CRITICAL' })).toThrow();
    expect(() => convertToTaskSchema.parse({ priority: 'high' })).toThrow();
    expect(() => convertToTaskSchema.parse({ priority: '' })).toThrow();
    expect(() => convertToTaskSchema.parse({ priority: null })).toThrow();
  });

  it('bounds the title at 255 and the notes at 2000', () => {
    expect(convertToTaskSchema.parse({ title: 'a'.repeat(255) }).title).toHaveLength(255);
    expect(() => convertToTaskSchema.parse({ title: 'a'.repeat(256) })).toThrow();

    expect(convertToTaskSchema.parse({ notes: 'a'.repeat(2000) }).notes).toHaveLength(2000);
    expect(() => convertToTaskSchema.parse({ notes: 'a'.repeat(2001) })).toThrow();
  });

  it('accepts an empty title — the service falls back to the subject', () => {
    // `.max(255).optional()` with no `.min(1)`, deliberately: the modal sends
    // whatever is in the box, and an empty box means "use the subject".
    expect(convertToTaskSchema.parse({ title: '' }).title).toBe('');
  });

  it('rejects non-string title and notes rather than coercing them', () => {
    expect(() => convertToTaskSchema.parse({ title: 42 })).toThrow();
    expect(() => convertToTaskSchema.parse({ notes: ['a', 'b'] })).toThrow();
  });

  it('drops unknown keys — a caller cannot smuggle in an owner', () => {
    const parsed = convertToTaskSchema.parse({ title: 'Reply', userId: 'someone-else', emailId: 'x' });

    expect(parsed).toEqual({ title: 'Reply' });
  });

  it('accepts every task field the create form has', () => {
    const input = {
      title: 'Reply to Ada',
      description: 'She asked twice',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      dueDate: '2026-10-01T09:00:00.000Z',
      startDate: '2026-09-28T09:00:00.000Z',
      remindAt: '2026-09-30T09:00:00.000Z',
      labelIds: ['4f5d8a0e-1c3b-4a7e-9f0a-2b6c8d1e3f5a'],
      customerId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      estimatedMinutes: 30,
      recurrence: 'RRULE:FREQ=WEEKLY',
      notes: 'From the thread',
    };

    expect(convertToTaskSchema.parse(input)).toEqual(input);
  });

  it('applies the task rules to those fields, not a looser copy', () => {
    // Each of these is a rule `createTaskSchema` enforces. If the convert
    // schema were re-declared by hand, any of them could be dropped without a
    // compile error; a parse that accepts one is the drift showing.
    expect(() => convertToTaskSchema.parse({ estimatedMinutes: -5 })).toThrow();
    expect(() => convertToTaskSchema.parse({ estimatedMinutes: 1.5 })).toThrow();
    expect(() => convertToTaskSchema.parse({ labelIds: ['not-a-uuid'] })).toThrow();
    expect(() => convertToTaskSchema.parse({ customerId: 'not-a-uuid' })).toThrow();
    expect(() => convertToTaskSchema.parse({ dueDate: 'tomorrow' })).toThrow();
    expect(() => convertToTaskSchema.parse({ recurrence: 'every week' })).toThrow();
  });

  it('accepts null for the clearable fields, as the task form does', () => {
    const parsed = convertToTaskSchema.parse({
      dueDate: null, startDate: null, remindAt: null, customerId: null, estimatedMinutes: null, recurrence: null,
    });

    expect(parsed).toEqual({
      dueDate: null, startDate: null, remindAt: null, customerId: null, estimatedMinutes: null, recurrence: null,
    });
  });

  it('has no parentId — a task made from an email is never a subtask', () => {
    const parsed = convertToTaskSchema.parse({ title: 'Reply', parentId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' });

    expect(parsed).toEqual({ title: 'Reply' });
  });
});
