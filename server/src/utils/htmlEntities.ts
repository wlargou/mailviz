/**
 * Decode HTML character references in text that is, and stays, text.
 *
 * Gmail hands back Subject headers and snippets HTML-escaped (`&amp;`, `&#39;`,
 * `&lt;`). Anything copied out of a synced message into one of our own rows —
 * `Task.description`, an outgoing `Subject:` header — has to be decoded, or the
 * entity reaches the reader literally.
 *
 * This is NOT an HTML parser, and its output is never treated as markup. It
 * decodes character references and nothing else: no tag handling, no
 * sanitising. A caller that interpolates the result into HTML must escape it
 * itself — see the deliberately pre-encoded `&lt;`/`&gt;` in
 * `emailService.replyToEmail`.
 *
 * **Single pass, deliberately.** The chained-replace form this replaces —
 * `.replace(/&amp;/g, '&').replace(/&lt;/g, '<')…` — decoded
 * `&amp;lt;script&amp;gt;` all the way to `<script>`, because `&amp;` was
 * substituted first and the `&lt;` that produced was then substituted again.
 * One regex with a callback cannot do that: each match is consumed once.
 *
 * **Six named entities**, because that is the set an HTML escaper emits and so
 * the set Gmail can deliver. The extended table (`&eacute;`, `&mdash;`) is
 * absent on purpose: Gmail escapes `&` itself, so a sender who literally typed
 * `&eacute;` sends `&amp;eacute;`, which must decode to the literal
 * `&eacute;` — while a real é arrives as UTF-8 and is never touched. Decoding
 * the extended table would corrupt the first case to fix nothing.
 *
 * `&nbsp;` becomes an ASCII space rather than U+00A0. That diverges from the
 * client's textarea decoder and from `entities`, and is intended: a
 * non-breaking space in a task description is invisible on screen and silently
 * unmatchable by the literal `contains` that task search uses.
 */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string | null | undefined): string {
  if (!text) return '';

  return text.replace(
    /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (match, body: string) => {
      if (body[0] !== '#') {
        const named = NAMED[body];
        return named === undefined ? match : named;
      }

      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);

      // Anything unrepresentable stays as written. U+0000 is not a cosmetic
      // problem: Postgres rejects it outright ("null character not permitted"),
      // so an unclamped `&#0;` would turn a convert-to-task call into a 500 on
      // the INSERT rather than a wrong string.
      if (
        !Number.isFinite(code) ||
        code === 0 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      ) {
        return match;
      }

      return String.fromCodePoint(code);
    }
  );
}
