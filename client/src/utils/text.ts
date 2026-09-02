/**
 * Decode HTML entities in text that will be rendered as plain text.
 *
 * Mail subjects and snippets arrive from Gmail already entity-encoded, so a
 * task made from one carries `&lt;`, `&amp;` and `&#39;` in its title and
 * description. Rendered through React — which escapes on output — those reach
 * the screen literally: "De : Phillips, Ollie &lt;oliver.phillips@hpe.com&gt;".
 *
 * A detached textarea is the decoder because assigning to `innerHTML` and
 * reading `value` performs exactly the entity expansion the browser would, with
 * no parsing of tags: a textarea's content model is raw text, so markup inside
 * it cannot become elements. The result is always used as a text node.
 *
 * Four components had their own byte-identical copy of this — ThreadDetail,
 * MailPage, ThreadItemList and ReviewCustomerGroup — before a fifth caller
 * made the duplication worth removing.
 */
const entityEl = typeof document !== 'undefined' ? document.createElement('textarea') : null;

export function decodeEntities(text: string | null | undefined): string {
  if (!text) return '';
  if (!entityEl) return text;
  entityEl.innerHTML = text;
  return entityEl.value;
}
