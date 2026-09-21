-- Which Gmail category tabs a user shows beside Primary.
ALTER TABLE "users" ADD COLUMN "mail_category_tabs" TEXT[] NOT NULL DEFAULT ARRAY['social', 'promotions', 'updates', 'forums']::TEXT[];

-- The inbox (`'INBOX' = ANY(label_ids)`) and the category tabs filter on the
-- label array; a GIN index is what serves `@>` and `&&` on it.
CREATE INDEX "emails_label_ids_idx" ON "emails" USING GIN ("label_ids");
