/**
 * Computes `engagement` for existing contacts.
 *
 *     npx tsx src/scripts/backfillContactEngagement.ts            # dry run
 *     npx tsx src/scripts/backfillContactEngagement.ts --apply
 *
 * Sync maintains this going forward; this is for rows that predate the column.
 *
 * Done in SQL, in two set-wide passes, because the obvious per-contact version is
 * not viable: correlated `EXISTS` subqueries against 112k emails for 11.7k
 * contacts ran past ten minutes before being killed. Gathering the two address
 * sets once and joining is the difference between minutes and seconds.
 *
 * Aliases count too — a merged contact answers to every address it absorbed, so
 * ignoring them would understate engagement for exactly the contacts someone has
 * already curated.
 */

import { prisma } from '../lib/prisma.js';

interface Row {
  id: string;
  engagement: string;
}

export async function backfillContactEngagement({ apply }: { apply: boolean }) {
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    WITH own AS (
      SELECT lower(u.email) AS addr, u.id AS user_id FROM users u
    ),
    -- Every address that has written to the account.
    senders AS (
      SELECT DISTINCT e.user_id, lower(e."from") AS addr
      FROM emails e
      WHERE e."from" <> ''
        AND lower(e."from") <> (SELECT addr FROM own o WHERE o.user_id = e.user_id)
    ),
    -- Every address the account has written to, from messages it sent.
    recipients AS (
      SELECT DISTINCT e.user_id, lower(a) AS addr
      FROM emails e
      JOIN own o ON o.user_id = e.user_id
      CROSS JOIN LATERAL unnest(e.to || e.cc) AS a
      WHERE lower(e."from") = o.addr
    ),
    -- A contact answers to its own address plus anything a merge folded in.
    contact_addr AS (
      SELECT c.id, cu.user_id, lower(c.email) AS addr
      FROM contacts c JOIN customers cu ON c.customer_id = cu.id
      WHERE c.email IS NOT NULL
      UNION
      SELECT c.id, cu.user_id, lower(al.email)
      FROM contact_email_aliases al
      JOIN contacts c ON c.id = al.contact_id
      JOIN customers cu ON c.customer_id = cu.id
    )
    SELECT ca.id,
      CASE
        WHEN bool_or(s.addr IS NOT NULL) AND bool_or(r.addr IS NOT NULL) THEN 'both'
        WHEN bool_or(s.addr IS NOT NULL) THEN 'sender'
        WHEN bool_or(r.addr IS NOT NULL) THEN 'receiver'
        ELSE 'none'
      END AS engagement
    FROM contact_addr ca
    LEFT JOIN senders s ON s.user_id = ca.user_id AND s.addr = ca.addr
    LEFT JOIN recipients r ON r.user_id = ca.user_id AND r.addr = ca.addr
    GROUP BY ca.id
  `);

  const current = new Map(
    (await prisma.contact.findMany({ select: { id: true, engagement: true } })).map((c) => [
      c.id,
      c.engagement,
    ])
  );

  const counts: Record<string, number> = { none: 0, sender: 0, receiver: 0, both: 0 };
  const changes: Row[] = [];
  for (const row of rows) {
    counts[row.engagement] = (counts[row.engagement] ?? 0) + 1;
    if (current.get(row.id) !== row.engagement) changes.push(row);
  }

  if (apply) {
    for (const engagement of ['none', 'sender', 'receiver', 'both']) {
      const ids = changes.filter((c) => c.engagement === engagement).map((c) => c.id);
      if (ids.length === 0) continue;
      // Chunked: a single `IN` list of several thousand ids is a query planner problem.
      for (let i = 0; i < ids.length; i += 1000) {
        await prisma.contact.updateMany({
          where: { id: { in: ids.slice(i, i + 1000) } },
          data: { engagement },
        });
      }
    }
  }

  return { total: rows.length, counts, changed: changes.length };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'Backfilling engagement…' : 'DRY RUN — nothing will be written.');
  backfillContactEngagement({ apply })
    .then(async (result) => {
      console.log('');
      console.log('  contacts        ', result.total);
      for (const key of ['both', 'sender', 'receiver', 'none']) {
        console.log(`  ${key.padEnd(16)}`, result.counts[key] ?? 0);
      }
      console.log('  rows to update  ', result.changed);
      if (!apply) console.log('\nRe-run with --apply to write.');
      await prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error('Failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
