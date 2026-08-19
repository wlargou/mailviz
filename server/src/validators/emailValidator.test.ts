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

  it('drops unknown keys — a caller cannot smuggle in a status or an owner', () => {
    const parsed = convertToTaskSchema.parse({ title: 'Reply', status: 'Done', userId: 'someone-else' });

    expect(parsed).toEqual({ title: 'Reply' });
  });
});
