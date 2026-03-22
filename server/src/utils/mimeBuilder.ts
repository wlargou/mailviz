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
  const sanitized = sanitize(options.htmlBody);
  const inlined = inlineCss(sanitized);
  const plainText = htmlToPlainText(sanitized);

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
  const message = await mail.compile().build();

  // Convert to base64url for Gmail API
  return message.toString('base64url');
}
