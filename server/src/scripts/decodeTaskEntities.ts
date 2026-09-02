/**
 * Decodes HTML entities left in existing task titles and descriptions.
 *
 *     npx tsx src/scripts/decodeTaskEntities.ts            # dry run
 *     npx tsx src/scripts/decodeTaskEntities.ts --apply
 *
 * Tasks converted from mail took the Gmail subject and snippet verbatim, and
 * Gmail escapes both. `convertToTask` now decodes at that boundary, so no new
 * row can be wrong — this is for the ones already stored.
 *
 * The client decodes on display, so these rows already *read* correctly, which
 * is why this is not urgent. It is still necessary, because task search is a
 * literal Postgres `contains`: a user reads `Merci d'avance` on the card, types
 * `d'avance` into the search box, and gets nothing, because the column holds
 * `d&#39;avance`. Display-time decoding cannot reach a WHERE clause.
 *
 * A script rather than a migration, per the convention here: a migration has to
 * apply to an empty database, and a data repair is a deliberate act rather than
 * something that happens on every deploy.
 *
 * Idempotent, but not by construction — that took work, and the naive version
 * was wrong. A snippet holding `&amp;lt;` is Gmail escaping text whose literal
 * content was `&lt;`; one decode correctly yields `&lt;`, and a second run over
 * the stored result yields `<`. The decoder is single-pass, so no single call
 * double-decodes, but two calls across two runs do.
 *
 * So a row is only rewritten when its decode is *stable* — when decoding twice
 * gives the same answer as decoding once. Rows that are not stable are
 * genuinely ambiguous (we cannot tell how many layers the sender intended) and
 * are counted and reported rather than guessed at. Re-running is then a no-op,
 * which is what `backfillAll` promises of every step.
 */

import { prisma } from '../lib/prisma.js';
import { decodeEntities } from '../utils/htmlEntities.js';

export async function decodeTaskEntities({ apply }: { apply: boolean }) {
  // `&` is the necessary first character of every entity, so this is a cheap
  // pre-filter. It over-selects — "R&D" matches and decodes to itself — and the
  // per-row comparison below is what decides.
  const tasks = await prisma.task.findMany({
    where: { OR: [{ title: { contains: '&' } }, { description: { contains: '&' } }] },
    select: { id: true, title: true, description: true },
  });

  /** Decoding twice must agree with decoding once, or we do not know how many layers were meant. */
  const stable = (value: string) => decodeEntities(decodeEntities(value)) === decodeEntities(value);

  const changes: Array<{ id: string; title: string; description: string | null }> = [];
  const ambiguous: string[] = [];

  for (const task of tasks) {
    if (!stable(task.title) || (task.description !== null && !stable(task.description))) {
      ambiguous.push(task.id);
      continue;
    }
    const title = decodeEntities(task.title);
    const description = task.description === null ? null : decodeEntities(task.description);
    if (title !== task.title || description !== task.description) {
      changes.push({ id: task.id, title, description });
    }
  }

  if (apply) {
    for (const change of changes) {
      await prisma.task.update({
        where: { id: change.id },
        data: { title: change.title, description: change.description },
      });
    }
  }

  return {
    scanned: tasks.length,
    changed: changes.length,
    ambiguous: ambiguous.length,
    sample: changes.slice(0, 5),
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'Decoding task entities…' : 'DRY RUN — nothing will be written.');
  decodeTaskEntities({ apply })
    .then(async (result) => {
      console.log('');
      console.log('  rows containing "&" ', result.scanned);
      console.log('  rows to update      ', result.changed);
      console.log('  ambiguous, skipped  ', result.ambiguous);
      for (const s of result.sample) console.log('    ', s.id, '→', JSON.stringify(s.title));
      if (!apply) console.log('\nRe-run with --apply to write.');
      await prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error('Failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
