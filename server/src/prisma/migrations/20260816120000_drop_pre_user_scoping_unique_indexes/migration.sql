-- Drop the pre-user-scoping GLOBAL unique indexes that 20260320060000_add_user_scoping
-- intended to remove but did not.
--
-- That migration used `ALTER TABLE ... DROP CONSTRAINT IF EXISTS "<name>_key"`.
-- Every one of those uniques had been created with `CREATE UNIQUE INDEX`, which
-- in Postgres produces an *index*, not a table constraint — so DROP CONSTRAINT
-- matched nothing and, because of IF EXISTS, failed silently. All six global
-- uniques are therefore still live alongside the per-user compound uniques that
-- were meant to replace them.
--
-- The effect is cross-tenant: one user claiming a value permanently denies it to
-- every other user. Concretely, before this migration a second user could not
--   * get a Customer for a domain another user already had (customers.domain),
--   * create a Label or CompanyCategory whose name another user had taken,
--   * receive the default TaskStatus rows the app creates per user, and
--   * sync a CalendarEvent for a meeting another user had already synced —
--     google_event_id is shared across the attendees of one event, so this hits
--     any two colleagues invited to the same meeting.
--
-- The schema only ever declared the compound uniques (@@unique([userId, ...])),
-- so dropping these brings the database in line with schema.prisma. DROP INDEX,
-- not DROP CONSTRAINT, is what actually removes them.
DROP INDEX IF EXISTS "task_statuses_name_key";
DROP INDEX IF EXISTS "company_categories_name_key";
DROP INDEX IF EXISTS "customers_domain_key";
DROP INDEX IF EXISTS "labels_name_key";
DROP INDEX IF EXISTS "emails_gmail_message_id_key";
DROP INDEX IF EXISTS "calendar_events_google_event_id_key";
