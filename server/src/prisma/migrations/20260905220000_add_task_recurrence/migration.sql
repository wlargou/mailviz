-- Recurring tasks.
--
-- `recurrence` is one RRULE line; finishing the task creates the next
-- occurrence with the due date advanced by it. `recurrence_next_id` points at
-- that occurrence and is unique, so a row can spawn at most one successor —
-- reopening a finished occurrence and finishing it again does not fork the
-- series. SET NULL on delete: deleting the successor does not delete history.
ALTER TABLE "tasks" ADD COLUMN "recurrence" VARCHAR(255);
ALTER TABLE "tasks" ADD COLUMN "recurrence_next_id" TEXT;

CREATE UNIQUE INDEX "tasks_recurrence_next_id_key" ON "tasks"("recurrence_next_id");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_next_id_fkey"
  FOREIGN KEY ("recurrence_next_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
