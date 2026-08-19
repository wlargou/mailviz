import { describe, it, expect } from 'vitest';
import { createSettingsItemSchema, updateSettingsItemSchema, reorderSchema } from './settingsValidator.js';

/**
 * Shared schemas for the two settings lists: task statuses and company
 * categories.
 *
 * Task statuses are the Kanban board's columns (they are rows in
 * `task_statuses`, not an enum), so a status created with an unusable label is
 * a column nobody can identify, and a colour that is not a hex string is a
 * swatch that renders as nothing.
 *
 * The pair of create/update schemas is where the care is needed: `create`
 * defaults the colour, `update` must not. They are written out separately
 * rather than derived with `.partial()` for exactly that reason — a derived
 * update schema keeps the default inside the optional wrapper and repaints
 * every item that is merely renamed.
 */

const UUID_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const UUID_B = '9c858901-8a57-4791-81fe-4c455b099bc9';

describe('createSettingsItemSchema', () => {
  it('accepts a label and defaults the colour', () => {
    expect(createSettingsItemSchema.parse({ label: 'In Review' }))
      .toEqual({ label: 'In Review', color: '#4589ff' });
  });

  it('requires a label', () => {
    expect(() => createSettingsItemSchema.parse({})).toThrow();
    expect(() => createSettingsItemSchema.parse({ label: '' })).toThrow();
  });

  it('trims the label before checking it is non-empty', () => {
    // Trimming after min(1) would let '   ' through as '', producing a Kanban
    // column with no visible name — and the schema's own message says
    // "Label is required".
    expect(createSettingsItemSchema.parse({ label: '  In Review  ' }).label).toBe('In Review');
    expect(() => createSettingsItemSchema.parse({ label: '   ' })).toThrow();
  });

  it('bounds the label at 100 characters', () => {
    expect(createSettingsItemSchema.parse({ label: 'a'.repeat(100) }).label).toHaveLength(100);
    expect(() => createSettingsItemSchema.parse({ label: 'a'.repeat(101) })).toThrow();
  });

  it('rejects anything that is not a six-digit hex colour', () => {
    expect(createSettingsItemSchema.parse({ label: 'x', color: '#A1B2C3' }).color).toBe('#A1B2C3');

    for (const color of ['#fff', 'ff0000', 'blue', '#ff00000', '#gggggg', '', '#ff0000; content: x']) {
      expect(() => createSettingsItemSchema.parse({ label: 'x', color }), `${JSON.stringify(color)} should be rejected`)
        .toThrow();
    }
  });

  it('drops unknown keys — position and ownership are not caller-supplied', () => {
    const parsed = createSettingsItemSchema.parse({ label: 'x', position: 99, userId: 'someone-else' });

    expect(parsed).not.toHaveProperty('position');
    expect(parsed).not.toHaveProperty('userId');
  });
});

describe('updateSettingsItemSchema', () => {
  it('does not invent a colour when only the label changes', () => {
    // If this schema were `createSettingsItemSchema.partial()`, the '#4589ff'
    // default would survive the optional wrapper and every rename would repaint
    // the status blue. Keeping the two schemas independent is what prevents it,
    // so the absence of the key is the assertion that matters.
    const parsed = updateSettingsItemSchema.parse({ label: 'Renamed' });

    expect(parsed).not.toHaveProperty('color');
    expect(parsed).toEqual({ label: 'Renamed' });
  });

  it('accepts a colour-only edit and an empty edit', () => {
    expect(updateSettingsItemSchema.parse({ color: '#ff0000' })).toEqual({ color: '#ff0000' });
    expect(updateSettingsItemSchema.parse({})).toEqual({});
  });

  it('still validates the fields that are present', () => {
    expect(() => updateSettingsItemSchema.parse({ label: '' })).toThrow();
    expect(() => updateSettingsItemSchema.parse({ label: '   ' })).toThrow();
    expect(() => updateSettingsItemSchema.parse({ label: 'a'.repeat(101) })).toThrow();
    expect(() => updateSettingsItemSchema.parse({ color: 'red' })).toThrow();
  });

  it('trims a supplied label', () => {
    expect(updateSettingsItemSchema.parse({ label: '  Renamed ' }).label).toBe('Renamed');
  });
});

/**
 * Reordering is a drag-and-drop of the whole list: the client sends every item
 * with its new position, and the controller writes them in one go. A bad id or
 * a negative position corrupts the ordering of a list the user cannot repair
 * except by dragging again.
 */
describe('reorderSchema', () => {
  it('accepts a list of id/position pairs', () => {
    const items = [{ id: UUID_A, position: 0 }, { id: UUID_B, position: 1 }];

    expect(reorderSchema.parse({ items })).toEqual({ items });
  });

  it('accepts an empty list', () => {
    expect(reorderSchema.parse({ items: [] })).toEqual({ items: [] });
  });

  it('requires the items key', () => {
    expect(() => reorderSchema.parse({})).toThrow();
  });

  it('requires uuid ids', () => {
    expect(() => reorderSchema.parse({ items: [{ id: 'status-1', position: 0 }] })).toThrow();
  });

  it('requires a non-negative integer position', () => {
    expect(() => reorderSchema.parse({ items: [{ id: UUID_A, position: -1 }] })).toThrow();
    expect(() => reorderSchema.parse({ items: [{ id: UUID_A, position: 1.5 }] })).toThrow();
    // Query-style strings must not be coerced — this is a JSON body, and a
    // string position would sort lexicographically ("10" before "9").
    expect(() => reorderSchema.parse({ items: [{ id: UUID_A, position: '1' }] })).toThrow();
    expect(() => reorderSchema.parse({ items: [{ id: UUID_A }] })).toThrow();
  });

  it('names the offending item by index', () => {
    const result = reorderSchema.safeParse({ items: [{ id: UUID_A, position: 0 }, { id: 'nope', position: 1 }] });

    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('items.1.id');
  });
});
