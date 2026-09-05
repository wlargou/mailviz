-- Dependencies between tasks: the blocker must finish before the blocked can.
--
-- A join table keyed on both ids, so a pair can only exist once. Cascade from
-- either side: a dependency on a task that no longer exists is not a fact.
-- Same-account ownership and acyclicity are the service's rules, not the
-- database's — a foreign key cannot express either.
CREATE TABLE "task_dependencies" (
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

CREATE INDEX "task_dependencies_blocked_id_idx" ON "task_dependencies"("blocked_id");

ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocker_id_fkey"
  FOREIGN KEY ("blocker_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocked_id_fkey"
  FOREIGN KEY ("blocked_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
