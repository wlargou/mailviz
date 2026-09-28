-- Companies become accounts, senders or ignored senders.
ALTER TABLE "customers" ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'SENDER';
CREATE INDEX "customers_user_id_status_idx" ON "customers"("user_id", "status");

-- An account is a company with a relationship: marked by hand (VIP, a
-- category), your own organisation, work against it (a task, deal or
-- tender), a meeting with it, or someone there you have written to. The
-- same rule the application re-applies after each sync (accountStatus.ts).
UPDATE "customers" c
SET "status" = 'ACCOUNT'
WHERE c."is_vip"
   OR c."is_internal"
   OR c."category_id" IS NOT NULL
   OR EXISTS (SELECT 1 FROM "tasks" t WHERE t."customer_id" = c."id")
   OR EXISTS (SELECT 1 FROM "deals" d WHERE d."customer_id" = c."id")
   OR EXISTS (SELECT 1 FROM "rfps" r WHERE r."customer_id" = c."id")
   OR EXISTS (SELECT 1 FROM "calendar_event_customers" e WHERE e."customer_id" = c."id")
   OR EXISTS (
     SELECT 1 FROM "contacts" ct
     WHERE ct."customer_id" = c."id" AND ct."engagement" IN ('receiver', 'both')
   );
