import { describe, it, expect } from 'vitest';
import { decodeEntities } from './text';

describe('decodeEntities', () => {
  it('decodes the entities Gmail actually sends', () => {
    // The three seen in real subjects: an escaped angle bracket pair around a
    // sender address, an ampersand, and a numeric-escaped apostrophe.
    expect(decodeEntities('De : Ollie &lt;o.phillips@hpe.com&gt;')).toBe(
      'De : Ollie <o.phillips@hpe.com>'
    );
    expect(decodeEntities('Contract &amp; License')).toBe('Contract & License');
    expect(decodeEntities('Q3 &#39;26 renewal')).toBe("Q3 '26 renewal");
  });

  it('returns an empty string for nothing at all', () => {
    // Callers interpolate the result straight into JSX, so null must not
    // surface as the text "null".
    expect(decodeEntities(null)).toBe('');
    expect(decodeEntities(undefined)).toBe('');
    expect(decodeEntities('')).toBe('');
  });

  it('does not turn markup in the text into elements', () => {
    // The decoder is a detached textarea, whose content model is raw text —
    // that is the reason it is safe to feed it untrusted subject lines. If it
    // were a div, this input would parse as a tag.
    expect(decodeEntities('&lt;img src=x onerror=alert(1)&gt;')).toBe(
      '<img src=x onerror=alert(1)>'
    );
    expect(document.querySelector('img')).toBeNull();
  });

  it('leaves text with no entities untouched', () => {
    expect(decodeEntities('plain subject line')).toBe('plain subject line');
  });
});
