-- Supports `DISTINCT ON (thread_id) ... ORDER BY thread_id, received_at DESC`,
-- which is how the dashboard finds the latest message of each recent thread.
--
-- Without it that query sorts every one of the user's emails. With it Postgres
-- walks the index in group order and takes the first row of each thread.
--
-- Measured against production (132,356 emails, 71,773 threads) before writing
-- this: the Prisma `distinct: ['threadId']` it replaces emitted SQL with no
-- DISTINCT and no LIMIT — it fetched all 132,356 rows and deduplicated them in
-- the client to return 8, taking 3.4s per dashboard load.
CREATE INDEX IF NOT EXISTS "emails_user_id_thread_id_received_at_idx"
  ON "emails" ("user_id", "thread_id", "received_at" DESC);
