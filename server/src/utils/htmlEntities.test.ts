import { describe, it, expect } from 'vitest';
import { decodeEntities } from './htmlEntities.js';

/**
 * The server-side entity decoder.
 *
 * Its whole job is the boundary where Gmail's text becomes ours — a task
 * description, an outgoing Subject header. What it must NOT do is as important
 * as what it must: it is not an HTML parser, it must not decode twice, and it
 * must not widen its table.
 */
describe('decodeEntities', () => {
  it('decodes the forms Gmail actually emits', () => {
    expect(decodeEntities('Merci d&#39;avance')).toBe("Merci d'avance");
    expect(decodeEntities('Ollie &lt;o.phillips@hpe.com&gt;')).toBe('Ollie <o.phillips@hpe.com>');
    expect(decodeEntities('Ben &amp; Co')).toBe('Ben & Co');
    expect(decodeEntities('say &quot;hello&quot;')).toBe('say "hello"');
    expect(decodeEntities('it&apos;s here')).toBe("it's here");
    expect(decodeEntities('a&#x27;b')).toBe("a'b");
  });

  it('turns &nbsp; into an ordinary space, not U+00A0', () => {
    // Deliberate divergence from the client's textarea decoder. A U+00A0 in a
    // task description is invisible on screen and silently unmatchable by the
    // literal `contains` that task search uses, so it must not survive.
    const out = decodeEntities('a&nbsp;b');
    expect(out).toBe('a b');
    expect(out.charCodeAt(1)).toBe(32);
  });

  it('does not double-decode', () => {
    // The load-bearing one. The chained-replace form this decoder replaces
    // substituted `&amp;` first and then re-substituted the `&lt;` it had just
    // produced, walking `&amp;lt;script&amp;gt;` all the way to live markup.
    expect(decodeEntities('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
    expect(decodeEntities('&amp;amp;')).toBe('&amp;');
  });

  it('leaves a bare ampersand alone', () => {
    expect(decodeEntities('a&b')).toBe('a&b');
    expect(decodeEntities('100% & more')).toBe('100% & more');
    expect(decodeEntities('R&D')).toBe('R&D');
  });

  it('leaves entities outside its table exactly as written', () => {
    // Pins the deliberate narrowness. Gmail escapes `&` itself, so a sender who
    // typed `&eacute;` sends `&amp;eacute;` and must get `&eacute;` back — a
    // wider table would corrupt that to é. Real accented text arrives as UTF-8
    // and never passes through here at all.
    expect(decodeEntities('&eacute; &hellip; &mdash;')).toBe('&eacute; &hellip; &mdash;');
    expect(decodeEntities('café')).toBe('café');
  });

  it('refuses code points that cannot be stored', () => {
    // Not cosmetic: Postgres rejects U+0000 outright, so an unclamped `&#0;`
    // would turn a convert-to-task call into a 500 on the INSERT.
    expect(decodeEntities('&#0;')).toBe('&#0;');
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;');
    expect(decodeEntities('&#99999999;')).toBe('&#99999999;');
  });

  it('returns an empty string for nothing at all', () => {
    // Pins the `decodeEntities(x) || undefined` chain in convertToTask: a null
    // snippet must stay absent rather than become the text "null".
    expect(decodeEntities(null)).toBe('');
    expect(decodeEntities(undefined)).toBe('');
    expect(decodeEntities('')).toBe('');
  });
});
