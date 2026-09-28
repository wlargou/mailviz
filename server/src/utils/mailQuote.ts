/**
 * The quoted original under a reply or a forward, in Gmail's own markup.
 *
 * `gmail_quote` is what Gmail, and most clients that learned from it, fold
 * behind a "•••" — so a reply sent from Mailviz no longer arrives with the
 * whole history spread open in the recipient's mail, and Mailviz's own
 * reader folds it the same way.
 */

export function replyQuote(attribution: string, bodyHtml: string): string {
  return (
    `<div class="gmail_quote"><div class="gmail_attr">${attribution}<br></div>` +
    `<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">` +
    `${bodyHtml}</blockquote></div>`
  );
}

export function forwardQuote(headerLines: string[], bodyHtml: string): string {
  return (
    `<div class="gmail_quote"><div class="gmail_attr">---------- Forwarded message ---------<br>` +
    `${headerLines.join('<br>')}<br></div><br><br>${bodyHtml}</div>`
  );
}
