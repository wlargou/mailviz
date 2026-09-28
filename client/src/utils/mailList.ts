import { decodeEntities } from './text';
import type { MailFilters } from '../components/mail/MailSearchBar';

/**
 * "To: Hicham +2" — how a list row names mail you sent. The Sent folder read
 * your own name on every row, which says nothing.
 */
export function sentTo(e: { to: string[]; cc: string[] }): string {
  const first = e.to[0] ?? e.cc[0];
  if (!first) return 'To: (no one)';
  const name = /^\s*"?([^"<]+?)"?\s*</.exec(first)?.[1]?.trim() || first.replace(/^.*<|>.*$/g, '').trim();
  const more = e.to.length + e.cc.length - 1;
  return `To: ${decodeEntities(name)}${more > 0 ? ` +${more}` : ''}`;
}

/**
 * What the Mail page asks the server for, given its filters. The Gmail
 * category goes only with the Inbox (Gmail categorises the inbox, not Sent or
 * Trash), and the participant's display name stays on the client.
 */
export function mailListParams(
  filters: MailFilters,
  opts: { page: number; pageSize: number; category: string },
): Record<string, string> {
  const params: Record<string, string> = { page: String(opts.page), limit: String(opts.pageSize) };
  if (filters.search) params.search = filters.search;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.participant) params.participant = filters.participant;
  if (filters.subject) params.subject = filters.subject;
  if (filters.dateAfter) params.dateAfter = filters.dateAfter;
  if (filters.dateBefore) params.dateBefore = filters.dateBefore;
  if (filters.customerIds.length > 0) params.customerId = filters.customerIds.join(',');
  if (filters.isRead !== null) params.isRead = filters.isRead;
  if (filters.hasAttachment) params.hasAttachment = 'true';
  if (filters.folder) params.folder = filters.folder;
  if (filters.folder === 'inbox') params.category = opts.category;
  return params;
}
