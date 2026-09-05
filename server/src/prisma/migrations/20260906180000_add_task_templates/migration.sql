-- Task templates: a saved tree of tasks with due dates relative to an anchor.
--
-- The tree is one JSONB column. A template is edited and applied as a whole,
-- never queried by its parts, so per-item rows would only add joins. The
-- name is unique per account, like email templates.
CREATE TABLE "task_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "items" JSONB NOT NULL,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_templates_user_id_name_key" ON "task_templates"("user_id", "name");
CREATE INDEX "task_templates_user_id_idx" ON "task_templates"("user_id");

ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
