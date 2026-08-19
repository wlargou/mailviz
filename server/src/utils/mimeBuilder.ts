import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import sanitizeHtml from 'sanitize-html';
import juice from 'juice';

export interface MimeAttachment {
  filename: string;
  content: string; // base64-encoded
  contentType: string;
}

export interface MimeOptions {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  attachments?: MimeAttachment[];
}

const SAFE_TAGS = [
  'p', 'br', 'b', 'i', 'u', 's', 'em', 'strong',
  'a', 'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'span', 'div', 'table', 'tr', 'td', 'th',
  'thead', 'tbody', 'img', 'pre', 'code',
];

const SAFE_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'width', 'height'],
  '*': ['style'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};

function sanitize(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: SAFE_TAGS,
    allowedAttributes: SAFE_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
  });
}

function inlineCss(html: string): string {
  return juice(html, { removeStyleTags: true });
}

function htmlToPlainText(html: string): string {
  let text = html;
  // Convert <br> and block-level closings to newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  // Convert links
  text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)');
  // Convert list items
  text = text.replace(/<li[^>]*>/gi, '- ');
  text = text.replace(/<\/li>/gi, '\n');
  // Convert blockquotes
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content: string) => {
    return content.split('\n').map((line: string) => `> ${line}`).join('\n');
  });
  // Convert <hr>
  text = text.replace(/<hr[^>]*>/gi, '\n---\n');
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Collapse excessive newlines
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

export async function buildMimeMessage(options: MimeOptions): Promise<string> {
  /**
   * Inline the CSS *before* sanitising, not after.
   *
   * `style` is not in SAFE_TAGS and sanitize-html drops the contents of a
   * `<style>` block along with the tag, so running juice second handed it HTML
   * whose stylesheet had already been deleted — every rule silently lost, and
   * `inlineCss` was dead code. Reversed, juice rewrites the rules into `style`
   * attributes (which SAFE_ATTRIBUTES does allow on any element) and sanitise
   * then removes the `<style>` tag itself along with anything else unsafe.
   *
   * Sanitising still has the last word, which is the property that matters:
   * juice only ever moves declarations into attributes, so nothing it emits can
   * reintroduce a tag or attribute the allowlist would reject.
   */
  const inlined = sanitize(inlineCss(options.htmlBody));
  const plainText = htmlToPlainText(inlined);

  const mailOptions: any = {
    from: options.from,
    to: options.to.join(', '),
    subject: options.subject,
    text: plainText,
    html: inlined,
  };

  if (options.cc && options.cc.length > 0) {
    mailOptions.cc = options.cc.join(', ');
  }
  if (options.bcc && options.bcc.length > 0) {
    mailOptions.bcc = options.bcc.join(', ');
  }
  if (options.inReplyTo) {
    mailOptions.inReplyTo = options.inReplyTo;
  }
  if (options.references) {
    mailOptions.references = options.references;
  }

  if (options.attachments && options.attachments.length > 0) {
    mailOptions.attachments = options.attachments.map((att) => ({
      filename: att.filename,
      content: Buffer.from(att.content, 'base64'),
      contentType: att.contentType,
    }));
  }

  const mail = new MailComposer(mailOptions);
  const compiled = mail.compile();

  /**
   * Keep the Bcc header in the built message.
   *
   * Nodemailer drops it by default, and for an SMTP transport that is right:
   * the blind recipients travel in the SMTP envelope, so leaving the header in
   * would expose them to everybody else. Gmail's `users.messages.send` has no
   * envelope — it reads To/Cc/Bcc off the raw message to decide who to deliver
   * to, and strips Bcc itself before relaying. Without this, every Bcc'd
   * address was silently dropped: the send returned 200 and the recipient
   * never got the mail.
   */
  compiled.keepBcc = true;

  const message = await compiled.build();

  // Convert to base64url for Gmail API
  return message.toString('base64url');
}
