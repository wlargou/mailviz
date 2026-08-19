import { describe, it, expect } from 'vitest';
import {
  createTemplateSchema,
  updateTemplateSchema,
  renderTemplateSchema,
  templateKindSchema,
} from './templateValidator.js';

/**
 * Template and snippet request schemas.
 *
 * `kind` is the field with teeth. It decides whether the row is a whole message
 * (subject + body) or a fragment dropped at the cursor, and `templateService`
 * uses it to decide whether to keep or null the subject. Because the service
 * resolves it as `data.kind ?? template.kind`, an invented `kind` is
 * indistinguishable from one the user chose — the schema is the only place that
 * distinction can be preserved.
 */

describe('templateKindSchema', () => {
  it('accepts the two kinds and nothing else', () => {
    expect(templateKindSchema.parse('template')).toBe('template');
    expect(templateKindSchema.parse('snippet')).toBe('snippet');
    expect(() => templateKindSchema.parse('fragment')).toThrow();
    expect(() => templateKindSchema.parse('')).toThrow();
  });
});

describe('createTemplateSchema', () => {
  it('accepts a minimal template and defaults kind', () => {
    const parsed = createTemplateSchema.parse({ name: 'Intro', body: '<p>Hello</p>' });

    expect(parsed.kind).toBe('template');
    expect(parsed.subject).toBeUndefined();
  });

  it('requires a name and a body', () => {
    expect(() => createTemplateSchema.parse({ body: '<p>x</p>' })).toThrow();
    expect(() => createTemplateSchema.parse({ name: 'Intro' })).toThrow();
    expect(() => createTemplateSchema.parse({ name: '', body: '<p>x</p>' })).toThrow();
    expect(() => createTemplateSchema.parse({ name: 'Intro', body: '' })).toThrow();
  });

  it('trims the name before checking it is non-empty', () => {
    // The name is the unique key (`userId_name`) and the only thing shown in the
    // picker, so a whitespace-only one is an unpickable row that also occupies
    // the empty name for good.
    expect(createTemplateSchema.parse({ name: '  Intro  ', body: '<p>x</p>' }).name).toBe('Intro');
    expect(() => createTemplateSchema.parse({ name: '   ', body: '<p>x</p>' })).toThrow();
  });

  it('bounds the name at 120 and the body at 100k', () => {
    expect(createTemplateSchema.parse({ name: 'a'.repeat(120), body: 'x' }).name).toHaveLength(120);
    expect(() => createTemplateSchema.parse({ name: 'a'.repeat(121), body: 'x' })).toThrow();

    expect(createTemplateSchema.parse({ name: 'Intro', body: 'a'.repeat(100_000) }).body).toHaveLength(100_000);
    expect(() => createTemplateSchema.parse({ name: 'Intro', body: 'a'.repeat(100_001) })).toThrow();
  });

  it('accepts a null subject — a snippet has none', () => {
    // Nullable rather than merely optional: turning a template into a snippet
    // sends `subject: null` to clear the stored one, and an optional-only field
    // would reject that and leave the old subject on the row.
    const parsed = createTemplateSchema.parse({ name: 'Sig', kind: 'snippet', body: '<p>x</p>', subject: null });

    expect(parsed.subject).toBeNull();
  });

  it('bounds the subject at 500 characters', () => {
    expect(createTemplateSchema.parse({ name: 'Intro', body: 'x', subject: 'a'.repeat(500) }).subject).toHaveLength(500);
    expect(() => createTemplateSchema.parse({ name: 'Intro', body: 'x', subject: 'a'.repeat(501) })).toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() => createTemplateSchema.parse({ name: 'Intro', body: 'x', kind: 'macro' })).toThrow();
  });
});

describe('updateTemplateSchema', () => {
  it('does not resurrect the kind default on a partial edit — REGRESSION', () => {
    // The bug: `.partial()` keeps `.default('template')` inside the optional
    // wrapper, so `{ name: 'Renamed' }` parsed to
    // `{ name: 'Renamed', kind: 'template' }`. templateService.update resolves
    // `data.kind ?? template.kind`, so the invented value won — renaming a
    // snippet converted it into a template, and it vanished from the snippet
    // list in compose. The file's own comment says the opposite is intended;
    // this test is what makes the comment true.
    const parsed = updateTemplateSchema.parse({ name: 'Renamed' });

    expect(parsed).not.toHaveProperty('kind');
    expect(updateTemplateSchema.parse({})).toEqual({});
  });

  it('still applies a kind the caller actually sent', () => {
    expect(updateTemplateSchema.parse({ kind: 'snippet' }).kind).toBe('snippet');
    expect(updateTemplateSchema.parse({ kind: 'template' }).kind).toBe('template');
  });

  it('distinguishes an absent subject from an explicit null', () => {
    // The service branches on `data.subject !== undefined`, so these two have
    // to stay distinguishable through parsing: absent keeps the stored subject,
    // null clears it.
    expect(updateTemplateSchema.parse({ name: 'Renamed' })).not.toHaveProperty('subject');
    expect(updateTemplateSchema.parse({ subject: null }).subject).toBeNull();
  });

  it('still validates the fields that are present', () => {
    expect(() => updateTemplateSchema.parse({ name: '' })).toThrow();
    expect(() => updateTemplateSchema.parse({ name: '   ' })).toThrow();
    expect(() => updateTemplateSchema.parse({ body: '' })).toThrow();
    expect(() => updateTemplateSchema.parse({ kind: 'macro' })).toThrow();
    expect(() => updateTemplateSchema.parse({ subject: 'a'.repeat(501) })).toThrow();
  });
});

describe('renderTemplateSchema', () => {
  it('accepts an empty context — compose may know nothing about the recipient', () => {
    expect(renderTemplateSchema.parse({})).toEqual({});
  });

  it('trims the recipient details', () => {
    // The service lowercases and matches `recipientEmail` against Contact rows;
    // an untrimmed address matches nothing and every {{firstName}} comes back
    // as "missing", which blocks the send.
    const parsed = renderTemplateSchema.parse({ recipientEmail: '  ada@acme.com  ', recipientName: '  Ada Lovelace ' });

    expect(parsed.recipientEmail).toBe('ada@acme.com');
    expect(parsed.recipientName).toBe('Ada Lovelace');
  });

  it('bounds the address at 320 characters and the name at 255', () => {
    expect(renderTemplateSchema.parse({ recipientEmail: 'a'.repeat(320) }).recipientEmail).toHaveLength(320);
    expect(() => renderTemplateSchema.parse({ recipientEmail: 'a'.repeat(321) })).toThrow();

    expect(renderTemplateSchema.parse({ recipientName: 'a'.repeat(255) }).recipientName).toHaveLength(255);
    expect(() => renderTemplateSchema.parse({ recipientName: 'a'.repeat(256) })).toThrow();
  });

  it('drops unknown context keys', () => {
    // The variable catalogue is closed on purpose; an extra key here would be a
    // value nothing in TEMPLATE_VARIABLES can name.
    expect(renderTemplateSchema.parse({ recipientEmail: 'ada@acme.com', company: 'Acme' }))
      .not.toHaveProperty('company');
  });
});
