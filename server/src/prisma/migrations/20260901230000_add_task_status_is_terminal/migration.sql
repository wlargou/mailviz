-- Which task statuses mean "finished".
--
-- Statuses are user-defined rows, but eight places in the code asked
-- `status = 'DONE'` — dashboard overdue counts, the notification scheduler,
-- task summaries. Rename or delete that status and completed tasks counted as
-- overdue forever, and the notification scheduler nagged about them every five
-- minutes. A dynamic vocabulary with one hard-coded member is not dynamic.
--
-- A flag rather than a reserved name so an account can have several finished
-- states — Done, Cancelled, Shipped — which is the point of the statuses being
-- user-defined in the first place.
ALTER TABLE "task_statuses" ADD COLUMN "is_terminal" BOOLEAN NOT NULL DEFAULT false;

-- Preserve today's behaviour exactly: DONE is what the code treated as
-- terminal, so DONE is what starts out marked. Scoped by name, applied per
-- user, and safe on an empty database — it simply matches nothing.
UPDATE "task_statuses" SET "is_terminal" = true WHERE "name" = 'DONE';
