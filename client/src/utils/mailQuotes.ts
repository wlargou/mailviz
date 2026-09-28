/**
 * Fold the quoted history under a reply.
 *
 * Every client repeats the whole conversation under each reply, so a
 * five-message thread rendered its history five times — the last message of
 * one thread ran to 7,214px, nearly all of it earlier messages already shown
 * above it. Gmail folds that history behind "•••"; this finds where it
 * starts and marks everything from there on with `data-mv-quoted`, which the
 * reader hides until asked.
 *
 * Where the history starts, by client:
 *  - Outlook on the web: an `<hr>` and `#divRplyFwdMsg` (the "De : … Envoyé
 *    : …" block).
 *  - Outlook desktop: a header block with a `border-top: solid #E1E1E1` rule.
 *  - Gmail and Mailviz: `.gmail_quote`.
 *  - Apple Mail and Thunderbird: `blockquote[type=cite]`, after its
 *    attribution line.
 *  - Yahoo: `.yahoo_quoted`; Outlook for Mac: `#OLK_SRC_BODY_SECTION`.
 *  - Mailviz before it used Gmail's markup: a div ruled `border-left: 2px
 *    solid #ccc`.
 *
 * Nothing is folded when the message is a forward (the forwarded mail *is*
 * the message), or when folding would leave nothing to read.
 */

export const QUOTED_ATTR = 'data-mv-quoted';

const FORWARD_SUBJECT = /^\s*(fwd?|fw|tr)\s*:/i;

const SELECTORS = [
  '#divRplyFwdMsg',
  '.gmail_quote_container',
  '.gmail_quote',
  'blockquote[type="cite"]',
  '.yahoo_quoted',
  '#OLK_SRC_BODY_SECTION',
  '.OutlookMessageHeader',
];

function styleOf(el: Element): string {
  return (el.getAttribute('style') ?? '').replace(/\s+/g, '').toLowerCase();
}

function candidates(root: Element): Element[] {
  const found: Element[] = [];
  for (const selector of SELECTORS) {
    const el = root.querySelector(selector);
    if (el) found.push(el);
  }
  for (const el of root.querySelectorAll('div[style]')) {
    const style = styleOf(el);
    // Outlook desktop's "From: … Sent: …" header, and Mailviz's old quote.
    if (/border-top:solid#(e1e1e1|b5c4df)/.test(style) || style.includes('border-left:2pxsolid#ccc')) {
      found.push(el);
      break;
    }
  }
  return found;
}

/** Earliest in document order. */
function first(elements: Element[]): Element | null {
  let best: Element | null = null;
  for (const el of elements) {
    if (!best || best.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) best = el;
  }
  return best;
}

/** Widen the start to take in the separator or attribution just before it. */
function widen(start: Element): Element {
  const prev = start.previousElementSibling;
  if (!prev) return start;
  // Outlook on the web rules the history off with an <hr> first.
  if (start.id === 'divRplyFwdMsg' && prev.tagName === 'HR') return prev;
  if (start.tagName === 'BLOCKQUOTE') {
    const text = (prev.textContent ?? '').trim();
    if (prev.classList.contains('moz-cite-prefix') || /(wrote|a écrit)\s*:?$/i.test(text)) return prev;
  }
  return start;
}

function mark(node: Node, doc: Document) {
  if (node.nodeType === Node.ELEMENT_NODE) {
    (node as Element).setAttribute(QUOTED_ATTR, '');
  } else if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim()) {
    // A bare text node cannot carry the attribute: wrap it.
    const span = doc.createElement('span');
    span.setAttribute(QUOTED_ATTR, '');
    node.parentNode?.insertBefore(span, node);
    span.appendChild(node);
  }
}

/** Mark `start`, everything after it, and everything after each of its ancestors. */
function markFrom(start: Element, root: Element, doc: Document) {
  const level: Node[] = [];
  for (let s: Node | null = start; s; s = s.nextSibling) level.push(s);
  level.forEach((n) => mark(n, doc));
  for (let a: Node | null = start.parentNode; a && a !== root; a = a.parentNode) {
    const after: Node[] = [];
    for (let s = a.nextSibling; s; s = s.nextSibling) after.push(s);
    after.forEach((n) => mark(n, doc));
  }
}

function visibleText(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  // Script and style are text no reader sees; the body arrives unsanitised.
  clone.querySelectorAll(`[${QUOTED_ATTR}], script, style, noscript, template`).forEach((el) => el.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function foldQuotedHistory(html: string, subject = ''): { html: string; folded: boolean } {
  if (!html || FORWARD_SUBJECT.test(subject)) return { html, folded: false };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body;
  const marker = first(candidates(root));
  if (!marker) return { html, folded: false };

  markFrom(widen(marker), root, doc);
  // Folding everything would leave an empty message: show it all instead.
  if (!visibleText(root)) return { html, folded: false };
  return { html: root.innerHTML, folded: true };
}

