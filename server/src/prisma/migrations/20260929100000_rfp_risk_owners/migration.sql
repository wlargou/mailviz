-- When the tender was published, and when questions to the buyer close.
ALTER TABLE "rfps" ADD COLUMN "published_at" TIMESTAMP(3);
ALTER TABLE "rfps" ADD COLUMN "questions_deadline_at" TIMESTAMP(3);

-- Who prepares each piece, and by when.
ALTER TABLE "rfp_folder_items" ADD COLUMN "assignee_id" TEXT;
ALTER TABLE "rfp_folder_items" ADD COLUMN "due_date" TIMESTAMP(3);

CREATE INDEX "rfp_folder_items_assignee_id_due_date_idx" ON "rfp_folder_items"("assignee_id", "due_date");

ALTER TABLE "rfp_folder_items" ADD CONSTRAINT "rfp_folder_items_assignee_id_fkey"
  FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
