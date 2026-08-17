import { prisma } from '../lib/prisma.js';

/**
 * Runs a per-account sync job, with the in-flight guard held **per account**
 * rather than globally.
 *
 * Both schedulers used to share one module-level `isSyncing` flag and walk users
 * sequentially. One account's first sync — which with `EMAIL_SYNC_MONTHS=0` means
 * every message in the mailbox — therefore blocked every other account's mail for
 * its whole duration, label changes included, because each following tick saw the
 * flag and returned immediately.
 *
 * The guard is still needed: a tick must not start a second sync for an account
 * whose previous one is still going, or the two race on the same history cursor.
 * It just has to be that account's guard and nobody else's.
 *
 * Accounts run concurrently up to `concurrency`. Gmail's quota is charged per
 * user and `lib/gmailLimiter.ts` keeps a Bottleneck group per user, so parallel
 * accounts do not eat each other's budget. The cap exists for local resources —
 * database connections above all — not for the API.
 */
export interface PerUserRunner {
  /** Sync every connected account, skipping any already in flight. */
  runAll(): Promise<void>;
  /** Sync one account now. Resolves immediately if it is already in flight. */
  runOne(userId: string): Promise<void>;
  isInFlight(userId: string): boolean;
  inFlightCount(): number;
}

export function createPerUserRunner(options: {
  label: string;
  concurrency: number;
  run: (userId: string) => Promise<void>;
}): PerUserRunner {
  const { label, concurrency, run } = options;
  const inFlight = new Set<string>();

  async function guarded(userId: string): Promise<void> {
    if (inFlight.has(userId)) {
      console.log(`[${label}] Skipping ${userId} — already syncing`);
      return;
    }
    inFlight.add(userId);
    try {
      await run(userId);
    } catch (err: unknown) {
      // A single account's failure must not stop the others.
      console.error(`[${label}] Sync failed for ${userId}:`, (err as Error)?.message ?? err);
    } finally {
      inFlight.delete(userId);
    }
  }

  return {
    async runAll() {
      const authRecords = await prisma.googleAuth.findMany({ select: { userId: true } });
      const queue = authRecords.map((record) => record.userId).filter((id) => !inFlight.has(id));
      if (queue.length === 0) return;

      // A fixed pool of workers pulling from a shared queue: accounts overlap, but
      // never more than `concurrency` at once regardless of how many are connected.
      let cursor = 0;
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (cursor < queue.length) {
          const userId = queue[cursor++];
          await guarded(userId);
        }
      });
      await Promise.all(workers);
    },

    async runOne(userId: string) {
      await guarded(userId);
    },

    isInFlight(userId: string) {
      return inFlight.has(userId);
    },

    inFlightCount() {
      return inFlight.size;
    },
  };
}
