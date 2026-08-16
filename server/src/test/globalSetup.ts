import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './databaseUrl.js';

/**
 * Runs once before the whole suite: bring the test database's schema up to date
 * with the committed migrations.
 *
 * `migrate deploy` rather than `migrate dev` — dev is interactive and will hang
 * in CI (documented in CLAUDE.md). Deploy applies exactly the migrations in the
 * repo, which is also what we want to be testing against.
 */
export default function globalSetup() {
  // Resolved from the shared module rather than read off process.env, because
  // globalSetup runs in Vitest's main process and does not receive `test.env`.
  const databaseUrl = TEST_DATABASE_URL;

  if (!/_test(\?|$)/.test(databaseUrl)) {
    // A guard, not a formality: `migrate deploy` writes to whatever it is
    // pointed at, and the suite truncates every table between cases. Pointing
    // this at the development database would destroy real data.
    throw new Error(
      `Refusing to run tests against a database whose name does not end in "_test": ${databaseUrl}`
    );
  }

  execSync('npx prisma migrate deploy --schema=src/prisma/schema.prisma', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
