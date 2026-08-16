import { randomBytes } from 'node:crypto';

/**
 * The database the test suite runs against.
 *
 * Shared by `vitest.config.ts` (which injects it as DATABASE_URL for the test
 * workers) and `globalSetup.ts` (which runs in Vitest's main process and so
 * does NOT see `test.env` — it has to resolve the value itself).
 *
 * Each run gets its OWN database. The suite truncates every table between
 * cases, so two runs sharing one database wipe each other's fixtures mid-test —
 * which showed up as foreign-key violations and Postgres 40P01 deadlocks when
 * two agents ran the suite at once. A per-run database also means a crashed run
 * can never leave state behind for the next one.
 *
 * Set TEST_DATABASE_URL to pin a specific database instead — useful for
 * inspecting the data after a failure, since a pinned database is not dropped
 * on teardown. It must still be named *_test; globalSetup refuses anything else.
 */

const ADMIN_DATABASE = 'postgres';

function baseUrl(): URL {
  const raw =
    process.env.TEST_DATABASE_BASE_URL ??
    'postgresql://mailviz:mailviz_dev@localhost:5435/postgres?schema=public';
  return new URL(raw);
}

function withDatabase(name: string): string {
  const url = baseUrl();
  url.pathname = `/${name}`;
  return url.toString();
}

/** True when the caller pinned a database, in which case we neither create nor drop it. */
export const IS_PINNED_DATABASE = Boolean(process.env.TEST_DATABASE_URL);

/**
 * Vitest loads `vitest.config.ts` and `globalSetup.ts` in separate module
 * graphs, so a name generated at module scope would be generated twice — the
 * config would bake one database into the workers' env while globalSetup
 * created a different one. Stashing it on `process.env` (shared across module
 * graphs in the same process) makes the first evaluation win.
 */
function resolveDatabaseName(): string {
  if (process.env.TEST_DATABASE_URL) {
    return new URL(process.env.TEST_DATABASE_URL).pathname.replace(/^\//, '');
  }
  const existing = process.env.MAILVIZ_TEST_DB_NAME;
  if (existing) return existing;

  const generated = `mailviz_test_${randomBytes(4).toString('hex')}`;
  process.env.MAILVIZ_TEST_DB_NAME = generated;
  return generated;
}

export const TEST_DATABASE_NAME = resolveDatabaseName();

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? withDatabase(TEST_DATABASE_NAME);

/** Connection to the maintenance database, for CREATE/DROP DATABASE. */
export const ADMIN_DATABASE_URL = withDatabase(ADMIN_DATABASE);
