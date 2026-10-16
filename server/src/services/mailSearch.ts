import { prisma } from '../lib/prisma.js';
import type { Prisma } from '../lib/prismaClient.js';
import { queryWords } from '../utils/searchTerms.js';

/**
 * What a typed mail search matches.
 *
 * Every word must match, in any order (`queryWords`), and a word matches a
 * message when it is
 *   - anywhere in its subject, sender or snippet — a substring, as it always
 *     was, so "marocmeteo" still finds ess.dgm@marocmeteo.ma; or
 *   - the start of a word of its body — "echeanc" finds "l'échéance", but
 *     "art" does not find every "partner".
 * Both without regard to case or accents. The columns are folded by the
 * database (migration `20261015100000_mail_search_text`), and what was typed
 * is folded here by the same SQL functions, so the two sides cannot disagree
 * about what "é" or "Œ" becomes. Both are trigram-indexed.
 */

interface Folded {
  /** The word folded, for a substring of `search_head`. */
  head: string;
  /** The word folded into words, each after a space, for `search_body`. */
  body: string;
}

export async function foldSearchWords(search: string | undefined): Promise<Folded[]> {
  const words = queryWords(search ?? '');
  if (words.length === 0) return [];
  return prisma.$queryRaw<Folded[]>`
    SELECT mv_search_fold(w) AS head, mv_search_words(w) AS body
    FROM unnest(${words}::text[]) WITH ORDINALITY AS t(w, i)
    ORDER BY i`;
}

/** One filter per typed word, to be pushed onto the caller's `AND`. */
export async function mailSearchFilters(search: string | undefined): Promise<Prisma.EmailWhereInput[]> {
  return (await foldSearchWords(search)).map(({ head, body }) => ({
    OR: [
      { searchHead: { contains: head } },
      // Punctuation alone folds to no word at all, and " " would match every body.
      ...(body.trim() ? [{ searchBody: { contains: body } }] : []),
    ],
  }));
}
