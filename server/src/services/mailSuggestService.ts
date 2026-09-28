import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { ownAddresses } from './repliesOwedService.js';
import { likePattern, queryWords } from '../utils/searchTerms.js';

/**
 * What the Mail search box suggests as you type: the people you correspond
 * with, and threads.
 *
 * People come from the mail itself, not from the contacts list. Contacts are
 * filed under companies, so anyone writing from a personal address had none —
 * 3,107 gmail.com threads in production against three junk contacts — and
 * could not be found by name at all. A person here is an address you have
 * received mail from, named by the name their mail carries, or one you have
 * written to. Your own addresses are never suggested.
 *
 * Own mail only: a thread someone shared with you is searchable in the list,
 * but its correspondents are not offered as yours.
 */

export interface SuggestedPerson {
  address: string;
  name: string | null;
  /** Messages exchanged, both ways. */
  messages: number;
  lastAt: Date;
  /** Everything from them came from a machine (noreply@, "root" …), and you never wrote to them. */
  automated: boolean;
}

export interface SuggestedThread {
  threadId: string;
  emailId: string;
  subject: string;
  from: string;
  fromName: string | null;
  receivedAt: Date;
}

export const SUGGESTED_PEOPLE = 5;
export const SUGGESTED_THREADS = 5;

/** Every word matches one of the columns: `(a ILIKE w1 OR b ILIKE w1) AND (a ILIKE w2 OR …)`. */
function everyWord(words: string[], columns: Prisma.Sql[]): Prisma.Sql {
  return Prisma.join(
    words.map((w) => {
      const pattern = likePattern(w);
      return Prisma.sql`(${Prisma.join(columns.map((col) => Prisma.sql`${col} ILIKE ${pattern}`), ' OR ')})`;
    }),
    ' AND ',
  );
}

export async function suggestMail(
  userId: string,
  q: string,
): Promise<{ people: SuggestedPerson[]; threads: SuggestedThread[] }> {
  if (q.trim().length < 2) return { people: [], threads: [] };
  const words = queryWords(q);
  const from = Prisma.sql`e."from"`;
  const fromName = Prisma.sql`e.from_name`;

  const [own, senders, recipients, recent] = await Promise.all([
    ownAddresses(userId),
    // Two steps: which senders match, then everything from them — counting
    // only the matching rows missed the mail they signed differently, and
    // named them by whichever variant matched. Senders are stored lower-case
    // and trimmed (all 138k rows, checked), so the join is a plain equality
    // that the index on `from` serves: ~110ms on the largest account.
    prisma.$queryRaw<Array<{ address: string; name: string | null; n: number; last_at: Date; automated: boolean }>>(Prisma.sql`
      WITH hits AS (
        SELECT e."from" AS address
        FROM emails e
        WHERE e.user_id = ${userId} AND ${everyWord(words, [from, fromName])}
        GROUP BY e."from"
        ORDER BY count(*) DESC
        LIMIT 50
      )
      SELECT h.address,
             (array_agg(e.from_name ORDER BY e.received_at DESC)
                FILTER (WHERE coalesce(trim(e.from_name), '') <> ''))[1] AS name,
             count(*)::int AS n,
             max(e.received_at) AS last_at,
             bool_and(e.is_automated) AS automated
      FROM hits h
      JOIN emails e ON e."from" = h.address AND e.user_id = ${userId}
      GROUP BY h.address
      ORDER BY n DESC
      LIMIT 20`),
    prisma.$queryRaw<Array<{ address: string; n: number; last_at: Date }>>(Prisma.sql`
      SELECT lower(r.addr) AS address, count(*)::int AS n, max(e.received_at) AS last_at
      FROM emails e
      CROSS JOIN LATERAL unnest(e."to" || e.cc || e.bcc) AS r(addr)
      WHERE e.user_id = ${userId}
        AND 'SENT' = ANY(e.label_ids)
        AND ${everyWord(words, [Prisma.sql`r.addr`])}
      GROUP BY lower(r.addr)
      ORDER BY n DESC
      LIMIT 20`),
    // The newest matches, deduplicated into threads below: ordering by date
    // with a limit lets Postgres stop early on a common word.
    prisma.$queryRaw<Array<{ id: string; thread_id: string; subject: string; from: string; from_name: string | null; received_at: Date }>>(Prisma.sql`
      SELECT e.id, e.thread_id, e.subject, e."from", e.from_name, e.received_at
      FROM emails e
      WHERE e.user_id = ${userId}
        AND NOT e.is_trashed
        AND e.thread_id IS NOT NULL
        AND ${everyWord(words, [Prisma.sql`e.subject`, fromName, from])}
      ORDER BY e.received_at DESC
      LIMIT 25`),
  ]);

  const byAddress = new Map<string, SuggestedPerson>();
  for (const s of senders) {
    if (own.has(s.address)) continue;
    byAddress.set(s.address, {
      address: s.address,
      name: s.name?.trim() || null,
      messages: s.n,
      lastAt: s.last_at,
      automated: s.automated,
    });
  }
  for (const r of recipients) {
    if (own.has(r.address)) continue;
    const known = byAddress.get(r.address);
    if (known) {
      known.messages += r.n;
      if (r.last_at > known.lastAt) known.lastAt = r.last_at;
      // You wrote to them: a correspondent, whatever their mail looks like.
      known.automated = false;
    } else {
      byAddress.set(r.address, { address: r.address, name: null, messages: r.n, lastAt: r.last_at, automated: false });
    }
  }

  // Someone you have only written to has no name on any mail you received;
  // the contacts list may know it.
  const nameless = [...byAddress.values()].filter((p) => !p.name).map((p) => p.address);
  if (nameless.length > 0) {
    const contacts = await prisma.contact.findMany({
      where: { customer: { userId }, email: { in: nameless } },
      select: { email: true, firstName: true, lastName: true },
    });
    for (const c of contacts) {
      const person = c.email ? byAddress.get(c.email.toLowerCase()) : undefined;
      const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
      if (person && name) person.name = name;
    }
  }

  // People before machines, then by how much you exchange, then by how recently.
  const people = [...byAddress.values()]
    .sort((a, b) =>
      Number(a.automated) - Number(b.automated)
      || b.messages - a.messages
      || b.lastAt.getTime() - a.lastAt.getTime())
    .slice(0, SUGGESTED_PEOPLE);

  const threads: SuggestedThread[] = [];
  const seen = new Set<string>();
  for (const e of recent) {
    if (seen.has(e.thread_id)) continue;
    seen.add(e.thread_id);
    threads.push({
      threadId: e.thread_id,
      emailId: e.id,
      subject: e.subject,
      from: e.from,
      fromName: e.from_name,
      receivedAt: e.received_at,
    });
    if (threads.length === SUGGESTED_THREADS) break;
  }

  return { people, threads };
}
