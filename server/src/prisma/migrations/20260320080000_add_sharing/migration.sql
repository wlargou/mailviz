-- Email Thread Sharing
CREATE TABLE "email_thread_shares" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "shared_by_user_id" TEXT NOT NULL,
    "shared_with_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_thread_shares_pkey" PRIMARY KEY ("id")
);

-- Deal Sharing
CREATE TABLE "deal_shares" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "shared_by_user_id" TEXT NOT NULL,
    "shared_with_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deal_shares_pkey" PRIMARY KEY ("id")
);

-- Unique constraints (one share per user per item)
CREATE UNIQUE INDEX "email_thread_shares_thread_id_shared_with_user_id_key" ON "email_thread_shares"("thread_id", "shared_with_user_id");
CREATE UNIQUE INDEX "deal_shares_deal_id_shared_with_user_id_key" ON "deal_shares"("deal_id", "shared_with_user_id");

-- Indexes for query performance
CREATE INDEX "email_thread_shares_shared_with_user_id_idx" ON "email_thread_shares"("shared_with_user_id");
CREATE INDEX "email_thread_shares_shared_by_user_id_idx" ON "email_thread_shares"("shared_by_user_id");
CREATE INDEX "email_thread_shares_thread_id_idx" ON "email_thread_shares"("thread_id");
CREATE INDEX "deal_shares_shared_with_user_id_idx" ON "deal_shares"("shared_with_user_id");
CREATE INDEX "deal_shares_shared_by_user_id_idx" ON "deal_shares"("shared_by_user_id");
CREATE INDEX "deal_shares_deal_id_idx" ON "deal_shares"("deal_id");

-- Foreign keys
ALTER TABLE "email_thread_shares" ADD CONSTRAINT "email_thread_shares_shared_by_user_id_fkey" FOREIGN KEY ("shared_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_thread_shares" ADD CONSTRAINT "email_thread_shares_shared_with_user_id_fkey" FOREIGN KEY ("shared_with_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_shares" ADD CONSTRAINT "deal_shares_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_shares" ADD CONSTRAINT "deal_shares_shared_by_user_id_fkey" FOREIGN KEY ("shared_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_shares" ADD CONSTRAINT "deal_shares_shared_with_user_id_fkey" FOREIGN KEY ("shared_with_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
