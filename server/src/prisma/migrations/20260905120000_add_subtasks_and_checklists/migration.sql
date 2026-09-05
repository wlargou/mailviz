-- Subtasks and checklists.
--
-- `parent_id` is nullable with no default: every existing task is a top-level
-- task, and NULL says exactly that. Cascade, because a subtask that outlives
-- its parent would surface in every list as an orphan with no context.
ALTER TABLE "tasks" ADD COLUMN "parent_id" TEXT;

CREATE INDEX "tasks_parent_id_idx" ON "tasks"("parent_id");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A checklist is the lightweight alternative: ordered lines on one task, no
-- status, no assignee, no due date. Deleted with the task.
CREATE TABLE "task_checklist_items" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "is_done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_checklist_items_task_id_idx" ON "task_checklist_items"("task_id");

ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
