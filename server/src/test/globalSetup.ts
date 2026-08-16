import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import {
  TEST_DATABASE_URL,
  TEST_DATABASE_NAME,
  ADMIN_DATABASE_URL,
  IS_PINNED_DATABASE,
} from './databaseUrl.js';

/**
 * Creates this run's database, brings it up to date with the committed
 * migrations, and drops it again afterwards.
 *
 * `migrate deploy` rather than `migrate dev` — dev is interactive and will hang
 * in CI (documented in CLAUDE.md). Deploy applies exactly the migrations in the
 * repo, which is also what we want to be testing: it proves the chain applies to
 * an EMPTY database, which is how a fresh clone and a first deploy both start.
 * That was genuinely broken once — a migration backfilled user_id from an empty
 * users table and then set the column NOT NULL.
 */

async function withAdminConnection<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient({ datasourceUrl: ADMIN_DATABASE_URL });
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}

export default async function globalSetup() {
  if (!/_test/.test(TEST_DATABASE_NAME)) {
    // A guard, not a formality: this applies migrations and the suite truncates
    // every table between cases. Pointed at the development database it would
    // destroy real data.
    throw new Error(
      `Refusing to run tests against a database whose name does not contain "_test": ${TEST_DATABASE_NAME}`
    );
  }

  if (!IS_PINNED_DATABASE) {
    await withAdminConnection((db) =>
      db.$executeRawUnsafe(`CREATE DATABASE "${TEST_DATABASE_NAME}"`)
    );
  }

  execSync('npx prisma migrate deploy --schema=src/prisma/schema.prisma', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });

  return async () => {
    // A pinned database is the caller's to keep — leaving it lets them inspect
    // the data after a failure.
    if (IS_PINNED_DATABASE) return;
    await withAdminConnection((db) =>
      // FORCE terminates any connection a worker failed to close, so a crashed
      // run cannot leave an undroppable database behind. Postgres 13+.
      db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DATABASE_NAME}" WITH (FORCE)`)
    );
  };
}
