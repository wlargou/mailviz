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

/** Parse comma-separated email addresses */
export function parseEmailList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => {
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

/** Convert plain text to basic HTML: escape, linkify, preserve line breaks */
export function plainTextToHtml(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Convert URLs to clickable links
  html = html.replace(
    /(https?:\/\/[^\s<>"')\]]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Convert email addresses to mailto links
  html = html.replace(
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    '<a href="mailto:$1">$1</a>'
  );

  // Convert newlines to <br> tags
  html = html.replace(/\n/g, '<br>');

  return html;
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
