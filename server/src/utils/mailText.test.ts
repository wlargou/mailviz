import { describe, it, expect } from 'vitest';
import { bodyText, BODY_TEXT_MAX } from './mailText.js';

/**
 * What mail search indexes of a body. Pinned: the plain part is preferred and
 * the HTML part stripped without gluing words or keeping styles; an attached
 * text file is not the body; links keep their host; quoted lines go; the cap
 * holds; and "no text in this payload" (null) is told apart from "empty" ('').
 */

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64url');
const part = (mimeType: string, text: string, filename = '') => ({ mimeType, filename, body: { data: b64(text) } });

describe('bodyText', () => {
  it('prefers the text/plain part', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [part('text/html', '<p>HTML version</p>'), part('text/plain', 'Plain version')],
    };
    expect(bodyText(payload)).toBe('Plain version');
  });

  it('strips the HTML part when there is no plain one, keeping words apart and styles out', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [{
        mimeType: 'multipart/alternative',
        parts: [part('text/html', '<html><head><style>.x{color:red}</style></head><body><p>Bonjour&nbsp;Omar</p><p>L&#39;&eacute;ch&eacute;ance</p><div>Mar<b>oc</b>Meteo &amp; co</div></body></html>')],
      }],
    };
    expect(bodyText(payload)).toBe('Bonjour Omar\nL\'échéance\nMarocMeteo & co');
  });

  it('reads a single-part message', () => {
    expect(bodyText(part('text/plain', 'Just this'))).toBe('Just this');
  });

  it('does not take an attached text file for the body', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [part('text/html', '<p>The body</p>'), part('text/plain', 'notes.txt contents', 'notes.txt')],
    };
    expect(bodyText(payload)).toBe('The body');
  });

  it('keeps a link’s host and drops its path', () => {
    expect(bodyText(part('text/plain', 'See https://tracking.example.com/c/AbC123?u=me@x.test now'))).toBe('See tracking.example.com now');
  });

  it('drops quoted lines and the characters Postgres or nobody can use', () => {
    expect(bodyText(part('text/plain', 'Fine by me.\n\n> On Monday you wrote:\n> the old text\nThanks\u0000​'))).toBe('Fine by me.\nThanks');
  });

  it('caps the text', () => {
    expect(bodyText(part('text/plain', 'word '.repeat(5000)))!.length).toBe(BODY_TEXT_MAX);
  });

  it('never ends on half a surrogate pair', () => {
    const text = bodyText(part('text/plain', 'a'.repeat(BODY_TEXT_MAX - 1) + '😀'))!;
    expect(text).toBe('a'.repeat(BODY_TEXT_MAX - 1));
  });

  it('tells a payload with no text (null) from an empty body (\'\')', () => {
    expect(bodyText({ mimeType: 'text/plain', body: { size: 0 } })).toBeNull();
    expect(bodyText({ mimeType: 'multipart/mixed', parts: [{ mimeType: 'application/pdf', filename: 'a.pdf', body: { data: b64('%PDF') } }] })).toBeNull();
    expect(bodyText(part('text/plain', '  \n '))).toBe('');
    expect(bodyText(undefined)).toBeNull();
  });
});
