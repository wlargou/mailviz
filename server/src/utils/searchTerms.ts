/**
 * How a typed search becomes a filter.
 *
 * Every word must match, anywhere and in any order: "omar alami" finds mail
 * from a sender who signs "ALAMI Omar", which the whole phrase as a single
 * substring never did. Capped, so a pasted paragraph is not forty ILIKEs a row.
 */
export function queryWords(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean).slice(0, 5);
}

/** A `contains` pattern for ILIKE: `%` and `_` typed by the user mean themselves. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
