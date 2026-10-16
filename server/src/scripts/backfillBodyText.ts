/**
 * Fills `emails.body_text` for mail synced before the sync stored it, so mail
 * search can find what was said and not only the subject and snippet.
 *
 *     railway ssh node /app/server/dist/scripts/backfillBodyText.js                 # dry run
 *     railway ssh node /app/server/dist/scripts/backfillBodyText.js --apply
 *     railway ssh node /app/server/dist/scripts/backfillBodyText.js --apply --limit=500
 *
 * Not part of `backfillAll`: that one is database-only and takes seconds,
 * while this asks Gmail for every message — one `messages.get` each, through
 * the per-user limiter in `getGmailClient`, so an hour or more per mailbox of
 * ~70k messages. Reading a message does not mark it read.
 *
 * Resumable by construction: a null `body_text` is the to-do list. Newest mail
 * goes first, being the most searched. A message Gmail no longer has, or one
 * with no text, gets '' so it is not asked for again; any other failure leaves
 * it null for the next run. Each message is fetched with its owner's Gmail
 * client and written under its owner's id.
 */

import { prisma } from '../lib/prisma.js';
import { getGmailClient } from '../lib/gmail.js';
import { isAlreadyGone } from '../lib/googleErrors.js';
import { bodyText } from '../utils/mailText.js';

const PENDING = { bodyText: null, gmailMessageId: { not: null } } as const;
/** Failures in one mailbox before it is given up on for this run. */
const MAX_FAILURES = 200;

interface Options {
  apply: boolean;
  /** Messages per mailbox, at most, for a trial run. */
  limit?: number;
  batchSize?: number;
  concurrency?: number;
  log?: (line: string) => void;
}

export interface MailboxResult {
  userId: string;
  pending: number;
  filled: number;
  /** Gone from Gmail, or no text: recorded as ''. */
  empty: number;
  failed: number;
  stopped?: string;
}

async function fillMailbox(userId: string, pending: number, opts: Required<Omit<Options, 'apply'>>): Promise<MailboxResult> {
  const result: MailboxResult = { userId, pending, filled: 0, empty: 0, failed: 0 };
  let gmail: Awaited<ReturnType<typeof getGmailClient>>;
  try {
    gmail = await getGmailClient(userId);
  } catch (err) {
    return { ...result, stopped: `no Gmail client: ${(err as Error).message}` };
  }

  const failed = new Set<string>();
  while (result.filled + result.empty < opts.limit) {
    const batch = await prisma.email.findMany({
      where: { userId, ...PENDING, ...(failed.size > 0 && { id: { notIn: [...failed] } }) },
      select: { id: true, gmailMessageId: true },
      orderBy: { receivedAt: 'desc' },
      take: Math.min(opts.batchSize, opts.limit - result.filled - result.empty),
    });
    if (batch.length === 0) break;

    for (let i = 0; i < batch.length; i += opts.concurrency) {
      await Promise.all(batch.slice(i, i + opts.concurrency).map(async (email) => {
        let text: string;
        try {
          const res = await gmail.users.messages.get({ userId: 'me', id: email.gmailMessageId!, format: 'full' });
          text = bodyText(res.data.payload) ?? '';
        } catch (err) {
          if (!isAlreadyGone(err)) {
            failed.add(email.id);
            result.failed++;
            return;
          }
          text = '';
        }
        await prisma.email.updateMany({ where: { id: email.id, userId }, data: { bodyText: text } });
        if (text) result.filled++;
        else result.empty++;
      }));
    }

    opts.log(`[${userId}] ${result.filled + result.empty}/${pending} (${result.failed} failed)`);
    if (failed.size >= MAX_FAILURES) {
      result.stopped = `${failed.size} failures — run again later`;
      break;
    }
  }
  return result;
}

export async function backfillBodyText({ apply, limit = Infinity, batchSize = 100, concurrency = 10, log = console.log }: Options) {
  const groups = await prisma.email.groupBy({ by: ['userId'], where: PENDING, _count: { id: true } });
  const pending = groups.map((g) => ({ userId: g.userId, pending: g._count.id }));
  if (!apply) return { apply, mailboxes: pending };

  // Mailboxes side by side: Gmail's quota, and the limiter, are per user.
  const mailboxes = await Promise.all(
    pending.map((m) => fillMailbox(m.userId, m.pending, { limit, batchSize, concurrency, log }))
  );
  return { apply, mailboxes };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const apply = process.argv.includes('--apply');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;
  backfillBodyText({ apply, limit })
    .then((r) => console.log(JSON.stringify(r, null, 2), apply ? '' : '\n(dry run — re-run with --apply)'))
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
