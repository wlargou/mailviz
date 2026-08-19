import { describe, it, expect } from 'vitest';
import { createLabelSchema, updateLabelSchema } from './labelValidator.js';

/**
 * Label request schemas.
 *
 * `color` is written into the DOM as a style value on every chip that carries
 * the label, so the hex pattern is doing double duty: it keeps the UI from
 * rendering a broken swatch, and it keeps an arbitrary attacker-chosen string
 * out of a style attribute. It has to be anchored at both ends — an unanchored
 * pattern would accept `#ff0000; background: url(...)` because it contains a
 * valid hex somewhere inside.
 */

describe('createLabelSchema', () => {
  it('accepts a name and a six-digit hex colour', () => {
    expect(createLabelSchema.parse({ name: 'Urgent', color: '#ff0000' }))
      .toEqual({ name: 'Urgent', color: '#ff0000' });
  });

  it('accepts uppercase hex', () => {
    expect(createLabelSchema.parse({ name: 'Urgent', color: '#FF00AA' }).color).toBe('#FF00AA');
  });

  it('requires both fields', () => {
    expect(() => createLabelSchema.parse({ name: 'Urgent' })).toThrow();
    expect(() => createLabelSchema.parse({ color: '#ff0000' })).toThrow();
    expect(() => createLabelSchema.parse({})).toThrow();
  });

  it('rejects an empty name and bounds it at 100 characters', () => {
    expect(() => createLabelSchema.parse({ name: '', color: '#ff0000' })).toThrow();
    expect(createLabelSchema.parse({ name: 'a'.repeat(100), color: '#ff0000' }).name).toHaveLength(100);
    expect(() => createLabelSchema.parse({ name: 'a'.repeat(101), color: '#ff0000' })).toThrow();
  });

  it('rejects every colour that is not exactly #rrggbb', () => {
    const bad = [
      '#fff',                       // the three-digit shorthand CSS allows
      '#ff00',
      '#ff00000',                   // seven digits
      '#ff000000',                  // eight digits (with alpha)
      'ff0000',                     // no hash
      'red',
      'rgb(255,0,0)',
      '#gggggg',                    // not hex digits
      ' #ff0000',                   // leading space
      '#ff0000 ',                   // trailing space
      '#ff0000; background: url(x)', // the reason the pattern is anchored
      '#ff0000\n#000000',
      '',
    ];

    for (const color of bad) {
      expect(() => createLabelSchema.parse({ name: 'Urgent', color }), `${JSON.stringify(color)} should be rejected`).toThrow();
    }
  });

  it('drops unknown keys', () => {
    expect(createLabelSchema.parse({ name: 'Urgent', color: '#ff0000', userId: 'someone-else' }))
      .not.toHaveProperty('userId');
  });
});

describe('updateLabelSchema', () => {
  it('allows renaming without resupplying the colour, and vice versa', () => {
    expect(updateLabelSchema.parse({ name: 'Later' })).toEqual({ name: 'Later' });
    expect(updateLabelSchema.parse({ color: '#00ff00' })).toEqual({ color: '#00ff00' });
    expect(updateLabelSchema.parse({})).toEqual({});
  });

  it('invents no colour when none was sent', () => {
    // An invented default here would repaint a label the user only renamed.
    expect(updateLabelSchema.parse({ name: 'Later' })).not.toHaveProperty('color');
  });

  it('still validates the fields that are present', () => {
    expect(() => updateLabelSchema.parse({ name: '' })).toThrow();
    expect(() => updateLabelSchema.parse({ color: 'red' })).toThrow();
  });
});
