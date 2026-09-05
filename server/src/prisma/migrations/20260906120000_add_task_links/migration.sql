-- Links from a task to a contact, a deal or a calendar event.
--
-- Polymorphic: `entity_type` names the table, so there is no foreign key to
-- the target. Ownership is checked in the service on write, and a link whose
-- target has since been deleted is dropped on read rather than shown as a
-- ghost. The reverse index serves "tasks linked to this deal".
CREATE TABLE "task_links" (
    "task_id" TEXT NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_links_pkey" PRIMARY KEY ("task_id","entity_type","entity_id")
);

CREATE INDEX "task_links_entity_type_entity_id_idx" ON "task_links"("entity_type", "entity_id");

ALTER TABLE "task_links" ADD CONSTRAINT "task_links_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
