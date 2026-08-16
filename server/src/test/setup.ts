import { beforeEach, afterAll } from 'vitest';
import { prisma } from '../lib/prisma.js';

/**
 * Truncate every table between tests so cases can't leak state into each other.
 *
 * Discovering the table list from the catalog rather than hardcoding it means a
 * new model can't silently start leaking rows between tests. `RESTART IDENTITY
 * CASCADE` in a single statement handles the foreign-key graph for us.
 */
async function truncateAll() {
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
