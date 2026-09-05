-- Email ↔ task becomes many-to-many.
--
-- The two single-column UNIQUE indexes made the link one-to-one: an email
-- could produce one task and a task could cite one email. Both were created
-- as indexes, not constraints, so DROP INDEX (not DROP CONSTRAINT — see the
-- CLAUDE.md gotcha) is what removes them. The pair stays unique.
DROP INDEX IF EXISTS "mail_to_tasks_email_id_key";
DROP INDEX IF EXISTS "mail_to_tasks_task_id_key";

CREATE UNIQUE INDEX "mail_to_tasks_email_id_task_id_key" ON "mail_to_tasks"("email_id", "task_id");
CREATE INDEX "mail_to_tasks_task_id_idx" ON "mail_to_tasks"("task_id");
CREATE INDEX "mail_to_tasks_email_id_idx" ON "mail_to_tasks"("email_id");
