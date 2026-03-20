-- CreateTable
CREATE TABLE "deal_partners" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "registration_url" VARCHAR(500),
    "logo_url" VARCHAR(500),
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "partner_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "products" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'TO_CHALLENGE',
    "expiry_date" TIMESTAMP(3),
    "notes" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deal_partners_user_id_name_key" ON "deal_partners"("user_id", "name");
CREATE INDEX "deal_partners_user_id_idx" ON "deal_partners"("user_id");

CREATE INDEX "deals_partner_id_idx" ON "deals"("partner_id");
CREATE INDEX "deals_customer_id_idx" ON "deals"("customer_id");
CREATE INDEX "deals_status_idx" ON "deals"("status");
CREATE INDEX "deals_user_id_idx" ON "deals"("user_id");

-- AddForeignKey
ALTER TABLE "deal_partners" ADD CONSTRAINT "deal_partners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deals" ADD CONSTRAINT "deals_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "deal_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
