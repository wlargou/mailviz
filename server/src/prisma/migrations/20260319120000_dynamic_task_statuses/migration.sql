-- CreateTable: task_statuses for dynamic status management
CREATE TABLE "task_statuses" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "color" VARCHAR(7) NOT NULL DEFAULT '#4589ff',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_statuses_name_key" ON "task_statuses"("name");

-- Seed default statuses
INSERT INTO "task_statuses" ("id", "name", "label", "color", "position") VALUES
    (gen_random_uuid(), 'TODO', 'To Do', '#4589ff', 0),
    (gen_random_uuid(), 'IN_PROGRESS', 'In Progress', '#f1c21b', 1),
    (gen_random_uuid(), 'DONE', 'Done', '#42be65', 2);

-- Convert status column from enum to varchar
-- First cast existing values to text, then drop the enum
ALTER TABLE "tasks" ALTER COLUMN "status" TYPE VARCHAR(100) USING "status"::text;
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'TODO';

-- Drop the old enum type
DROP TYPE IF EXISTS "TaskStatus";
