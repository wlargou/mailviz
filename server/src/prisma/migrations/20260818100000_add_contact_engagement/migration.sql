-- Which direction mail has ever flowed with a contact.
--
-- Defaults to 'none' so it applies to an empty database and an existing one
-- alike. Existing rows are computed by `scripts/backfillContactEngagement.ts`;
-- new mail maintains it during sync.
ALTER TABLE "contacts" ADD COLUMN "engagement" VARCHAR(20) NOT NULL DEFAULT 'none';

CREATE INDEX "contacts_customer_id_engagement_idx" ON "contacts"("customer_id", "engagement");
