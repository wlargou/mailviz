-- Time spent on tasks.
--
-- A running timer is a row with no ended_at. The (user_id, ended_at) index
-- serves "this person's running timer", which is read on every panel open
-- and by the header chip. Cascade from both the task and the user.
CREATE TABLE "task_time_entries" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_time_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_time_entries_task_id_idx" ON "task_time_entries"("task_id");
CREATE INDEX "task_time_entries_user_id_ended_at_idx" ON "task_time_entries"("user_id", "ended_at");

ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
