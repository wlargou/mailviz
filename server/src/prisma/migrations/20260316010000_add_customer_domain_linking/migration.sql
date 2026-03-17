-- AlterTable
ALTER TABLE "customers" ADD COLUMN "domain" VARCHAR(255),
ADD COLUMN "logo_url" VARCHAR(500);

-- CreateIndex
CREATE UNIQUE INDEX "customers_domain_key" ON "customers"("domain");

-- CreateTable
CREATE TABLE "calendar_event_customers" (
    "calendar_event_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,

    CONSTRAINT "calendar_event_customers_pkey" PRIMARY KEY ("calendar_event_id","customer_id")
);

-- AddForeignKey
ALTER TABLE "calendar_event_customers" ADD CONSTRAINT "calendar_event_customers_calendar_event_id_fkey" FOREIGN KEY ("calendar_event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_customers" ADD CONSTRAINT "calendar_event_customers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "emails" ADD COLUMN "customer_id" TEXT;

-- CreateIndex
CREATE INDEX "emails_customer_id_idx" ON "emails"("customer_id");

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
