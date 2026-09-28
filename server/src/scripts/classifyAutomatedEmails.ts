/**
 * Flags existing mail from machines (`emails.is_automated`), so it leaves
 * Primary for Updates.
 *
 * New mail is flagged at sync; this is for mail that predates the column.
 * Classifies each distinct sender once rather than each row — there are far
 * fewer senders than messages. Idempotent, and it both sets and clears the
 * flag, so re-running after the vocabulary in `contactKind.ts` is tuned is
 * the intended use.
 *
 * Outbound mail is never flagged; its sender is the account's own address.
 */

import { prisma } from '../lib/prisma.js';
import { isAutomatedSender } from '../utils/automatedSender.js';

export async function classifyAutomatedEmails({ apply }: { apply: boolean }) {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  let senders = 0;
  let automatedSenders = 0;
  let toFlag = 0;
  let toClear = 0;

  for (const user of users) {
    const own = user.email.trim().toLowerCase();
    const groups = await prisma.email.groupBy({
      by: ['from', 'fromName', 'isAutomated'],
      where: { userId: user.id },
      _count: { id: true },
    });

    // Keyed by address *and* display name: a cron job mailing as "root"
    // from an address a person also uses must not flag that person's mail.
    const flag: Array<{ from: string; fromName: string | null }> = [];
    const clear: Array<{ from: string; fromName: string | null }> = [];
    const seen = new Set<string>();
    for (const g of groups) {
      const automated = g.from.trim().toLowerCase() !== own && isAutomatedSender(g.from, g.fromName);
      if (!seen.has(g.from)) {
        seen.add(g.from);
        senders++;
        if (automated) automatedSenders++;
      }
      if (automated && !g.isAutomated) { flag.push({ from: g.from, fromName: g.fromName }); toFlag += g._count.id; }
      if (!automated && g.isAutomated) { clear.push({ from: g.from, fromName: g.fromName }); toClear += g._count.id; }
    }

    if (apply) {
      for (const [pairs, isAutomated] of [[flag, true], [clear, false]] as const) {
        for (const { from, fromName } of pairs) {
          await prisma.email.updateMany({ where: { userId: user.id, from, fromName }, data: { isAutomated } });
        }
      }
    }
  }

  return { senders, automatedSenders, toFlag, toClear };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const apply = process.argv.includes('--apply');
  classifyAutomatedEmails({ apply })
    .then((r) => console.log(r, apply ? '' : '(dry run — re-run with --apply)'))
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
