-- Task assignment
ALTER TABLE "tasks" ADD COLUMN "assigned_to_id" TEXT;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "tasks_assigned_to_id_idx" ON "tasks"("assigned_to_id");

-- Task sharing
CREATE TABLE "task_shares" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "shared_by_user_id" TEXT NOT NULL,
    "shared_with_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_shares_task_id_shared_with_user_id_key" ON "task_shares"("task_id", "shared_with_user_id");
CREATE INDEX "task_shares_shared_with_user_id_idx" ON "task_shares"("shared_with_user_id");
CREATE INDEX "task_shares_shared_by_user_id_idx" ON "task_shares"("shared_by_user_id");
CREATE INDEX "task_shares_task_id_idx" ON "task_shares"("task_id");

ALTER TABLE "task_shares" ADD CONSTRAINT "task_shares_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_shares" ADD CONSTRAINT "task_shares_shared_by_user_id_fkey" FOREIGN KEY ("shared_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_shares" ADD CONSTRAINT "task_shares_shared_with_user_id_fkey" FOREIGN KEY ("shared_with_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
