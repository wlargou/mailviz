-- The buying organisation behind a tender, when it is one of ours.
-- Nullable and ON DELETE SET NULL: deleting a company must not take its
-- tenders with it.
ALTER TABLE "rfps" ADD COLUMN "customer_id" TEXT;

CREATE INDEX "rfps_customer_id_idx" ON "rfps"("customer_id");

ALTER TABLE "rfps" ADD CONSTRAINT "rfps_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
