# Server test harness

```bash
npm test --workspace=server     # or: npx vitest run
npm run test:watch --workspace=server
```

## It runs against a real Postgres

Not a mocked Prisma client — deliberately. The cross-tenant leaks this suite
exists to prevent were **where-clause construction** bugs:

```ts
const where = { ...ownershipFilter };   // ownership lands in where.OR
if (query.search) { where.OR = [...] }  // …and the search branch erases it
```

A mock would have accepted that happily. Only a real database shows that the
rows come back. The same bug shipped independently in `dealService` and
`emailService`, so it is a pattern, not a one-off.

## Each run gets its own database

`globalSetup` creates `mailviz_test_<random>`, applies the committed migrations
with `prisma migrate deploy`, and drops it afterwards.

Per-run rather than one shared database because `setup.ts` truncates every table
between cases — two concurrent runs wipe each other's fixtures, which surfaces
as foreign-key violations and Postgres `40P01` deadlocks rather than anything
that reads like a test problem. It also means a crashed run leaves nothing
behind.

Applying migrations to a brand-new database every run is not just setup cost: it
continuously proves the chain works from empty, which is how a fresh clone and a
first deploy both start. That was broken once — a migration backfilled `user_id`
from an empty `users` table and then set the column `NOT NULL`.

**To keep the data after a failure**, pin a database:

```bash
TEST_DATABASE_URL='postgresql://mailviz:mailviz_dev@localhost:5435/mailviz_test_keep?schema=public' npx vitest run
```

A pinned database is not created or dropped for you — create it yourself, and it
survives so you can inspect it. The name must contain `_test`; `globalSetup`
refuses anything else, because it applies migrations and truncates everything.

Point the suite at a different server with `TEST_DATABASE_BASE_URL` (CI does).

## Single fork, on purpose

`TRUNCATE` takes an `AccessExclusiveLock`, so parallel workers deadlock against
each other. `vitest.config.ts` pins `pool: 'forks'` with one worker.
`fileParallelism: false` alone is not enough — Vitest still spawns several
workers.

## Writing tests

`src/test/factories.ts` defaults to **two users**, because the bug class worth
catching is "user A can see user B's data". The standard shape is: create two
users, give both some data, assert one cannot see the other's.

Follow `src/services/dealService.test.ts`: a doc comment saying *why* the file
exists, and regression cases named `— REGRESSION` that spell out the bug they
lock down.

**Verify a regression test actually fails without its fix.** Reintroduce the
bug, watch it go red, then revert. A regression test that has never failed is a
guess. Every one in this suite has been checked that way.
