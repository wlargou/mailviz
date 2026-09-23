-- Sharing a tender with a colleague, mirroring task_shares and deal_shares.
CREATE TABLE "rfp_shares" (
    "id" TEXT NOT NULL,
    "rfp_id" TEXT NOT NULL,
    "shared_by_user_id" TEXT NOT NULL,
    "shared_with_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfp_shares_pkey" PRIMARY KEY ("id")
);

-- One share per (tender, recipient): sharing twice is not two shares.
CREATE UNIQUE INDEX "rfp_shares_rfp_id_shared_with_user_id_key" ON "rfp_shares"("rfp_id", "shared_with_user_id");
CREATE INDEX "rfp_shares_shared_with_user_id_idx" ON "rfp_shares"("shared_with_user_id");
CREATE INDEX "rfp_shares_shared_by_user_id_idx" ON "rfp_shares"("shared_by_user_id");
CREATE INDEX "rfp_shares_rfp_id_idx" ON "rfp_shares"("rfp_id");

ALTER TABLE "rfp_shares" ADD CONSTRAINT "rfp_shares_rfp_id_fkey" FOREIGN KEY ("rfp_id") REFERENCES "rfps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfp_shares" ADD CONSTRAINT "rfp_shares_shared_by_user_id_fkey" FOREIGN KEY ("shared_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfp_shares" ADD CONSTRAINT "rfp_shares_shared_with_user_id_fkey" FOREIGN KEY ("shared_with_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
