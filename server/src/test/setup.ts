import { beforeEach, afterAll } from 'vitest';
import { prisma } from '../lib/prisma.js';

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

async function truncateAll() {
  await assertTestDatabase();
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});
