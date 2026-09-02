import { describe, it, expect } from 'vitest';
import { createTaskSchema, updateTaskSchema, reorderSchema } from './taskValidator.js';

/**
 * Task request schemas.
 *
 * Two decisions in here are load-bearing and easy to "tidy" into a bug:
 *
 * - **`status` is a free string, not an enum.** Statuses are rows in
 *   `task_statuses` that the user creates, so an enum would reject every custom
 *   column the moment someone renames one. The bound (1..100) matches the
 *   settings schema's label so a status that can be created can also be used.
 * - **`null` and absent mean different things.** `dueDate`, `customerId`,
 *   `assignedToId` and `estimatedMinutes` are all `.nullable().optional()`:
 *   null clears the column, absent leaves it alone. A schema that only allowed
 *   `undefined` would make "remove the due date" impossible, which is the kind
 *   of bug that reads as "the X button doesn't work".
 */

const UUID_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const UUID_B = '9c858901-8a57-4791-81fe-4c455b099bc9';

describe('createTaskSchema', () => {
  it('accepts a title on its own', () => {
    expect(createTaskSchema.parse({ title: 'Call Ada' })).toEqual({ title: 'Call Ada' });
  });

  it('requires a non-empty title and bounds it at 255', () => {
    expect(() => createTaskSchema.parse({})).toThrow();
    expect(() => createTaskSchema.parse({ title: '' })).toThrow();
    expect(createTaskSchema.parse({ title: 'a'.repeat(255) }).title).toHaveLength(255);
    expect(() => createTaskSchema.parse({ title: 'a'.repeat(256) })).toThrow();
  });

  it('takes any user-defined status, not a fixed set', () => {
    // The Kanban columns come from the task_statuses table, so 'Waiting on
    // legal' has to be as valid as 'To Do'. An enum here would 400 every custom
    // column.
    expect(createTaskSchema.parse({ title: 'x', status: 'Waiting on legal' }).status).toBe('Waiting on legal');
    expect(createTaskSchema.parse({ title: 'x', status: 'a'.repeat(100) }).status).toHaveLength(100);

    expect(() => createTaskSchema.parse({ title: 'x', status: '' })).toThrow();
    expect(() => createTaskSchema.parse({ title: 'x', status: 'a'.repeat(101) })).toThrow();
  });

  it('trims the status, like the schema that creates the columns', () => {
    // task_statuses stores trimmed labels (createSettingsItemSchema trims
    // first), so '  Done  ' can never match a column that exists — the card
    // lands in a Kanban lane the board does not render. Whitespace-only is the
    // same bug with nothing left over.
    expect(createTaskSchema.parse({ title: 'x', status: '  Done  ' }).status).toBe('Done');
    expect(() => createTaskSchema.parse({ title: 'x', status: '   ' })).toThrow();
  });

  it('accepts only the four priorities', () => {
    for (const priority of ['LOW', 'MEDIUM', 'HIGH', 'URGENT']) {
      expect(createTaskSchema.parse({ title: 'x', priority }).priority).toBe(priority);
    }
    // Priority is a Prisma enum column: an unlisted value is a P2009 crash
    // reported as a 500 rather than a 400 naming the field.
    expect(() => createTaskSchema.parse({ title: 'x', priority: 'CRITICAL' })).toThrow();
    expect(() => createTaskSchema.parse({ title: 'x', priority: 'low' })).toThrow();
  });

  it('requires an ISO UTC dueDate, and accepts null to mean "no due date"', () => {
    expect(createTaskSchema.parse({ title: 'x', dueDate: '2026-09-01T09:00:00Z' }).dueDate)
      .toBe('2026-09-01T09:00:00Z');
    expect(createTaskSchema.parse({ title: 'x', dueDate: null }).dueDate).toBeNull();

    // A date-only string reaches Prisma as an invalid Date and every overdue
    // query that reads the row back inherits the problem.
    expect(() => createTaskSchema.parse({ title: 'x', dueDate: '2026-09-01' })).toThrow();
    expect(() => createTaskSchema.parse({ title: 'x', dueDate: '' })).toThrow();
    expect(() => createTaskSchema.parse({ title: 'x', dueDate: 'next week' })).toThrow();
  });

  it('requires uuids for every relation id', () => {
    const parsed = createTaskSchema.parse({ title: 'x', customerId: UUID_A, assignedToId: UUID_B, labelIds: [UUID_A] });
    expect(parsed.customerId).toBe(UUID_A);
    expect(parsed.assignedToId).toBe(UUID_B);
    expect(parsed.labelIds).toEqual([UUID_A]);

    expect(() => createTaskSchema.parse({ title: 'x', customerId: 'acme' })).toThrow();
    expect(() => createTaskSchema.parse({ title: 'x', assignedToId: 'bob' })).toThrow();
    expect(() => createTaskSchema.parse({ title: 'x', labelIds: [UUID_A, 'urgent'] })).toThrow();
  });

  it('accepts null for customerId and assignedToId to unlink and unassign', () => {
    const parsed = createTaskSchema.parse({ title: 'x', customerId: null, assignedToId: null });

    expect(parsed.customerId).toBeNull();
    expect(parsed.assignedToId).toBeNull();
  });

  it('takes estimatedMinutes as a non-negative integer, or null', () => {
    expect(createTaskSchema.parse({ title: 'x', estimatedMinutes: 0 }).estimatedMinutes).toBe(0);
    expect(createTaskSchema.parse({ title: 'x', estimatedMinutes: null }).estimatedMinutes).toBeNull();

    expect(() => createTaskSchema.parse({ title: 'x', estimatedMinutes: -1 })).toThrow();
    expect(() => createTaskSchema.parse({ title: 'x', estimatedMinutes: 1.5 })).toThrow();
    // No coercion: this is a JSON body, and a numeric string arriving here means
    // the client is sending form values where a number is expected.
    expect(() => createTaskSchema.parse({ title: 'x', estimatedMinutes: '30' })).toThrow();
  });

  it('drops unknown keys — ownership and position are never caller-supplied', () => {
    const parsed = createTaskSchema.parse({ title: 'x', userId: 'someone-else', position: 3, completedAt: 'now' });

    expect(parsed).toEqual({ title: 'x' });
  });
});

describe('updateTaskSchema', () => {
  it('accepts a single-field edit and invents nothing', () => {
    // Everything reaching taskService.update is written to the row, so an
    // invented key would overwrite a column the caller never mentioned.
    expect(updateTaskSchema.parse({ status: 'Done' })).toEqual({ status: 'Done' });
    expect(updateTaskSchema.parse({})).toEqual({});
  });

  it('lets a due date, an assignee and an estimate be cleared', () => {
    const parsed = updateTaskSchema.parse({ dueDate: null, assignedToId: null, estimatedMinutes: null });

    expect(parsed.dueDate).toBeNull();
    expect(parsed.assignedToId).toBeNull();
    expect(parsed.estimatedMinutes).toBeNull();
  });

  it('still validates the fields that are present', () => {
    expect(() => updateTaskSchema.parse({ title: '' })).toThrow();
    expect(() => updateTaskSchema.parse({ status: '' })).toThrow();
    expect(() => updateTaskSchema.parse({ priority: 'SOON' })).toThrow();
    expect(() => updateTaskSchema.parse({ dueDate: '2026-09-01' })).toThrow();
    expect(() => updateTaskSchema.parse({ customerId: 'acme' })).toThrow();
  });
});

/**
 * Kanban drag-and-drop. Each item carries the column it landed in as well as
 * its position, and the controller writes them together — a missing status
 * would move a card to a new position in a column nobody named.
 */
describe('reorderSchema', () => {
  it('accepts a list of id/status/position triples', () => {
    const items = [
      { id: UUID_A, status: 'In Progress', position: 0 },
      { id: UUID_B, status: 'Done', position: 1 },
    ];

    expect(reorderSchema.parse({ items })).toEqual({ items });
  });

  it('accepts an empty list and requires the items key', () => {
    expect(reorderSchema.parse({ items: [] })).toEqual({ items: [] });
    expect(() => reorderSchema.parse({})).toThrow();
  });

  it('requires every field of every item', () => {
    expect(() => reorderSchema.parse({ items: [{ id: UUID_A, position: 0 }] })).toThrow();
    expect(() => reorderSchema.parse({ items: [{ id: UUID_A, status: 'Done' }] })).toThrow();
    expect(() => reorderSchema.parse({ items: [{ status: 'Done', position: 0 }] })).toThrow();
    expect(() => reorderSchema.parse({ items: [{ id: 'task-1', status: 'Done', position: 0 }] })).toThrow();
    expect(() => reorderSchema.parse({ items: [{ id: UUID_A, status: '', position: 0 }] })).toThrow();
  });

  it('requires a non-negative integer position', () => {
    expect(() => reorderSchema.parse({ items: [{ id: UUID_A, status: 'Done', position: -1 }] })).toThrow();
    expect(() => reorderSchema.parse({ items: [{ id: UUID_A, status: 'Done', position: 0.5 }] })).toThrow();
    expect(() => reorderSchema.parse({ items: [{ id: UUID_A, status: 'Done', position: '0' }] })).toThrow();
  });

  it('names the offending item by index', () => {
    const result = reorderSchema.safeParse({
      items: [{ id: UUID_A, status: 'Done', position: 0 }, { id: UUID_B, status: 'Done', position: -3 }],
    });

    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('items.1.position');
  });
});

describe('description trims before the service normalises it', () => {
  it('reduces a whitespace-only description to the empty string', () => {
    // The two halves are split across layers on purpose: the validator makes
    // "   " and "" the same input, and taskService turns "" into NULL. Without
    // the trim here a user who clears the box by selecting-all and typing a
    // space stores three spaces — a third empty state that reads as content.
    expect(updateTaskSchema.parse({ description: '   ' })).toEqual({ description: '' });
    expect(updateTaskSchema.parse({ description: '  hi  ' })).toEqual({ description: 'hi' });
  });

  it('still refuses null, so there is one way to clear', () => {
    // `.nullable()` here would ADMIT null without converting '', leaving three
    // spellings of empty where the service can only normalise one.
    expect(() => updateTaskSchema.parse({ description: null })).toThrow();
  });
});

