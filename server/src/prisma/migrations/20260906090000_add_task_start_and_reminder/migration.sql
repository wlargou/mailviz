-- Start dates and reminders on tasks.
--
-- All nullable with no default: an existing task has no start date and no
-- reminder, and NULL says exactly that. `reminder_sent_at` is what makes a
-- reminder fire once — the sweep selects `remind_at <= now AND
-- reminder_sent_at IS NULL` and stamps it, and editing `remind_at` clears it.
ALTER TABLE "tasks" ADD COLUMN "start_date" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "remind_at" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "reminder_sent_at" TIMESTAMP(3);

CREATE INDEX "tasks_start_date_idx" ON "tasks"("start_date");
CREATE INDEX "tasks_remind_at_reminder_sent_at_idx" ON "tasks"("remind_at", "reminder_sent_at");
