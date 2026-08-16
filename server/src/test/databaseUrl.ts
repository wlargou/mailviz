/**
 * The database the test suite runs against.
 *
 * Shared by `vitest.config.ts` (which injects it as DATABASE_URL for the test
 * workers) and `globalSetup.ts` (which runs in Vitest's main process and so
 * does NOT see `test.env` — it has to resolve the value itself).
 *
 * Deliberately a different database from development: the suite truncates every
 * table between tests.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://mailviz:mailviz_dev@localhost:5435/mailviz_test?schema=public';
