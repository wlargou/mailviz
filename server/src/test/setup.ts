import { beforeEach, afterAll } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { auditService } from '../services/auditService.js';

/**
 * Truncate every table between tests so cases can't leak state into each other.
 *
 * Discovering the table list from the catalog rather than hardcoding it means a
 * new model can't silently start leaking rows between tests. `RESTART IDENTITY
 * CASCADE` in a single statement handles the foreign-key graph for us.
 */
/**
 * Refuse to truncate anything that is not a test database.
 *
 * `globalSetup` already checks this, but it runs in Vitest's main process while
 * the truncation runs in the workers — a worker started with a stray
 * DATABASE_URL would never reach that check. The development database holds
 * ~112k real emails and cannot be regenerated, so the destructive statement
 * verifies its own target rather than trusting a guard in another process.
 */
async function assertTestDatabase() {
  const [{ current_database: name }] = await prisma.$queryRaw<
    Array<{ current_database: string }>
  >`SELECT current_database()`;
  if (!/_test/.test(name)) {
    throw new Error(
      `Refusing to TRUNCATE "${name}": test databases must be named *_test. ` +
        'Check DATABASE_URL — this would have destroyed real data.'
    );
  }
}

/**
 * `TRUNCATE` takes an AccessExclusiveLock on every table at once, so it
 * deadlocks against any statement still in flight from the test that just
 * finished.
 *
 * There is always such a statement: `auditService.log` is deliberately
 * fire-and-forget, so a route test returns while its audit INSERT is still
 * running, holding a RowShareLock on `users` for the foreign-key check.
 * Postgres then has one process waiting for AccessExclusiveLock and the other
 * for RowShareLock, and kills one of them.
 *
 * So drain those writes first — `auditService.flush()` is what makes them
 * waitable. Retrying the TRUNCATE instead is not good enough: Postgres spends a
 * full `deadlock_timeout` (1s by default) detecting each collision, so a few
 * retries push an ordinary test past its timeout. The loop below is only a
 * backstop for a straggler from somewhere else, and is deliberately short.
 *
 * Rare enough that it took a coverage run's timing to surface it, which is
 * exactly the kind of flake that turns up first in CI.
 */
function isDeadlock(err: unknown): boolean {
  return err instanceof Error && /deadlock detected|40P01/.test(err.message);
}

async function truncateAll() {
  await assertTestDatabase();
  await auditService.flush();
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  const statement = `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`;

  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$executeRawUnsafe(statement);
      return;
    } catch (err) {
      if (!isDeadlock(err) || attempt >= 1) throw err;
      // Give the straggler a moment to finish before contending again.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  // Drain before dropping the connection. Tearing down mid-INSERT is what
  // leaves a promise that never settles, and one of those used to be enough to
  // hang every `beforeEach` in the next file.
  await auditService.flush();
  await prisma.$disconnect();
});
