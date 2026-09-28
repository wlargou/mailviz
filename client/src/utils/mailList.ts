import { decodeEntities } from './text';

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
