import sanitizeHtml from 'sanitize-html';
import { decodeEntities } from './htmlEntities.js';

/**
 * A message's body as plain text, for mail search (`emails.body_text`).
 *
 * Search only: nothing displays this, so it is tidied for matching rather than
 * reading. The text/plain part is preferred — it is the sender's own text
 * rendering and carries no markup — and the HTML part is stripped when there
 * is no plain one. Links keep their host and lose their path, which in mail is
 * mostly tracking tokens; quoted lines (`> …`) are dropped, since the message
 * they quote is in the thread and indexed on its own.
 */

/**
 * Characters kept per message. In production the median body is ~3k
 * characters of text and the 95th percentile ~27k, most of it signatures,
 * legal footers and quoted history by then.
 */
export const BODY_TEXT_MAX = 10_000;

interface Part {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null; size?: number | null } | null;
  parts?: Part[] | null;
}

/** The first inline part of this type with content — never an attached file. */
function findPart(part: Part, mimeType: string): string | null {
  if (part.mimeType === mimeType && !part.filename && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf-8');
  }
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found !== null) return found;
  }
  return null;
}

/** Block-level tags end a line: without this `<p>a</p><p>b</p>` reads "ab". */
const BLOCK = /<\/?(?:p|div|br|li|tr|td|th|h[1-6]|table|blockquote|ul|ol|section|header|footer)\b[^>]*>/gi;

function htmlToText(html: string): string {
  const text = sanitizeHtml(html.replace(BLOCK, '\n$&'), {
    allowedTags: [],
    allowedAttributes: {},
    // Dropped with their contents: a stylesheet is not words.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'head', 'title'],
  });
  // sanitize-html escapes the text it keeps.
  return decodeEntities(text);
}

function tidy(text: string): string {
  const tidied = text
    // Postgres refuses U+0000 in text outright.
    .replace(/\u0000/g, '')
    // Invisible characters marketing mail pads its preview with.
    .replace(/[­͏​-‍⁠﻿]/g, '')
    .replace(/https?:\/\/([^/\s?#<>"']+)[^\s<>"']*/gi, '$1')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  let capped = tidied.slice(0, BODY_TEXT_MAX);
  // Never end on half a surrogate pair.
  if (/[\ud800-\udbff]$/.test(capped)) capped = capped.slice(0, -1);
  return capped;
}

/**
 * The body text of a Gmail message payload (`format: 'full'`), or null when
 * the payload carries no text at all — a metadata fetch, or a message that is
 * nothing but attachments. The sync leaves the column alone on null; the
 * backfill records '' so it does not ask Gmail again.
 */
export function bodyText(payload: Part | null | undefined): string | null {
  if (!payload) return null;
  const plain = findPart(payload, 'text/plain');
  if (plain !== null && plain.trim()) return tidy(plain);
  const html = findPart(payload, 'text/html');
  if (html !== null) return tidy(htmlToText(html));
  return plain === null ? null : '';
}
