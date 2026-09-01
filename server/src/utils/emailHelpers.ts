/**
 * Shared email helper functions used by emailService and emailComposeService.
 * Extracted from emailService.ts (A4: split large file into modules).
 */

/** Parse "Display Name <email@domain.com>" format */
export function parseEmailAddress(raw: string): { email: string; name: string | null } {
  const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    let name = match[1].trim()
      .replace(/^["']+|["']+$/g, '')  // Strip leading/trailing quotes (single and double)
      .replace(/\[.*?\]/g, '')         // Strip bracketed suffixes like [C]
      .trim();
    return { name: name || null, email: match[2].toLowerCase() };
  }
  // Fallback: try to extract email from angle brackets anywhere in the string
  const emailMatch = raw.match(/<([^>]+@[^>]+)>/);
  if (emailMatch) {
    return { name: null, email: emailMatch[1].toLowerCase() };
  }
  return { name: null, email: raw.trim().toLowerCase() };
}

/**
 * Split an address-list header on the commas that actually separate addresses.
 *
 * A plain `split(',')` is wrong for the single most common corporate header
 * shape there is: `"Doe, John" <john@example.com>`. Outlook writes display
 * names surname-first, and the comma inside the quoted string is part of the
 * name, not a separator. Splitting on it produced a phantom recipient `"doe`
 * on every such message — junk in `Email.to`, and, because `draftService` reads
 * a Gmail draft's recipients through here and hands them straight back to
 * `buildMimeMessage`, a re-saved draft addressed to a real person.
 *
 * Commas inside `<…>` are honoured for the same reason: a quoted local part
 * (`<"a,b"@example.com>`) is legal and would otherwise be torn in half.
 */
function splitAddressList(raw: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];

    if (inQuotes && char === '\\' && i + 1 < raw.length) {
      // Escaped character inside a quoted string — including an escaped quote,
      // which must not be read as the end of the string.
      current += char + raw[i + 1];
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && char === '<') {
      inAngle = true;
    } else if (!inQuotes && char === '>') {
      inAngle = false;
    } else if (char === ',' && !inQuotes && !inAngle) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** Parse comma-separated email addresses */
export function parseEmailList(raw: string | undefined): string[] {
  if (!raw) return [];
  return splitAddressList(raw).map((s) => {
    const { email } = parseEmailAddress(s.trim());
    return email;
  }).filter(Boolean);
}

/** Extract attachment metadata from Gmail message payload */
export function extractAttachments(payload: any): Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> {
  const attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> = [];

  function walk(parts: any[]) {
    if (!parts) return;
    for (const part of parts) {
      if (part.body?.attachmentId && part.filename) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.parts) walk(part.parts);
    }
  }

  if (payload.parts) walk(payload.parts);
  return attachments;
}

/**
 * URLs and bare addresses, matched in ONE pass with the URL branch first.
 *
 * The order and the single pass are both load-bearing. Linkifying URLs and then
 * addresses in two passes means the address pass runs over HTML the first pass
 * just wrote — and an address inside a URL (`/unsubscribe/bob@corp.com`, a
 * `?email=` parameter, a `user@host` prefix) then gets a second anchor injected
 * *inside the href attribute*, which destroys the link:
 *
 *   href="https://mail.example.com/u/<a href="mailto:bob@corp.com">bob@…
 *
 * Unsubscribe footers carrying the recipient's own address are about as common
 * as plain-text mail gets, so this was not a corner case.
 */
const LINKABLE = /(https?:\/\/[^\s<>"')\]]+)|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

/** Convert plain text to basic HTML: escape, linkify, preserve line breaks */
export function plainTextToHtml(text: string): string {
  // Escaping first is what makes the rest safe: by the time anything is written
  // into an href, every quote and angle bracket in the input is already an
  // entity, so a crafted URL cannot close the attribute.
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const linked = escaped.replace(LINKABLE, (_match, url?: string, email?: string) =>
    url
      ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
      : `<a href="mailto:${email}">${email}</a>`
  );

  return linked.replace(/\n/g, '<br>');
}

/** Extract HTML or plain text body from Gmail message payload */
export function extractBody(payload: any): string | null {
  function findPart(parts: any[], mimeType: string): string | null {
    if (!parts) return null;
    for (const part of parts) {
      if (part.mimeType === mimeType && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
      if (part.parts) {
        const found = findPart(part.parts, mimeType);
        if (found) return found;
      }
    }
    return null;
  }

  // Prefer HTML, fall back to plain text (converted to HTML)
  if (payload.parts) {
    const html = findPart(payload.parts, 'text/html');
    if (html) return html;
    const plain = findPart(payload.parts, 'text/plain');
    if (plain) return plainTextToHtml(plain);
  }

  // Single-part message
  if (payload.body?.data) {
    const raw = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    if (payload.mimeType === 'text/html') return raw;
    return plainTextToHtml(raw);
  }

  return null;
}

/**
 * Sentinel accepted in the `customerId` query parameter meaning "mail with no
 * customer link" (the review flow's Uncategorized bucket). Real customer ids
 * are uuids, so this can never shadow one.
 */
export const UNCATEGORIZED_CUSTOMER_ID = 'none';

export interface EmailQueryParams {
  search?: string;
  customerId?: string;
  contactEmail?: string;
  isRead?: string;
  hasAttachment?: string;
  folder?: string;
  from?: string;
  to?: string;
  subject?: string;
  dateAfter?: string;
  dateBefore?: string;
  page?: string;
  limit?: string;
}
