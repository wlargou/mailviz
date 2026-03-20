-- S1/D1: Add user_id to all data models for multi-tenancy isolation
-- This migration:
-- 1. Adds user_id columns (nullable initially)
-- 2. Backfills with the first existing user's ID
-- 3. Makes user_id NOT NULL
-- 4. Drops old unique constraints and creates compound uniques with user_id
-- 5. Adds indexes for user_id

-- Step 1: Add nullable user_id columns
ALTER TABLE "tasks" ADD COLUMN "user_id" TEXT;
ALTER TABLE "task_statuses" ADD COLUMN "user_id" TEXT;
ALTER TABLE "company_categories" ADD COLUMN "user_id" TEXT;
ALTER TABLE "customers" ADD COLUMN "user_id" TEXT;
ALTER TABLE "labels" ADD COLUMN "user_id" TEXT;
ALTER TABLE "emails" ADD COLUMN "user_id" TEXT;
ALTER TABLE "calendar_events" ADD COLUMN "user_id" TEXT;

-- Step 2: Backfill with the first user's ID
UPDATE "tasks" SET "user_id" = (SELECT id FROM "users" LIMIT 1) WHERE "user_id" IS NULL;
UPDATE "task_statuses" SET "user_id" = (SELECT id FROM "users" LIMIT 1) WHERE "user_id" IS NULL;
UPDATE "company_categories" SET "user_id" = (SELECT id FROM "users" LIMIT 1) WHERE "user_id" IS NULL;
UPDATE "customers" SET "user_id" = (SELECT id FROM "users" LIMIT 1) WHERE "user_id" IS NULL;
UPDATE "labels" SET "user_id" = (SELECT id FROM "users" LIMIT 1) WHERE "user_id" IS NULL;
UPDATE "emails" SET "user_id" = (SELECT id FROM "users" LIMIT 1) WHERE "user_id" IS NULL;
UPDATE "calendar_events" SET "user_id" = (SELECT id FROM "users" LIMIT 1) WHERE "user_id" IS NULL;

-- Step 3: Make user_id NOT NULL
ALTER TABLE "tasks" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "task_statuses" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "company_categories" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "customers" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "labels" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "emails" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "calendar_events" ALTER COLUMN "user_id" SET NOT NULL;

-- Step 4: Drop old unique constraints, create compound uniques
-- TaskStatus: name was unique globally, now unique per user
ALTER TABLE "task_statuses" DROP CONSTRAINT IF EXISTS "task_statuses_name_key";
CREATE UNIQUE INDEX "task_statuses_user_id_name_key" ON "task_statuses"("user_id", "name");

-- CompanyCategory: name was unique globally, now unique per user
ALTER TABLE "company_categories" DROP CONSTRAINT IF EXISTS "company_categories_name_key";
CREATE UNIQUE INDEX "company_categories_user_id_name_key" ON "company_categories"("user_id", "name");

-- Customer: domain was unique globally, now unique per user
ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "customers_domain_key";
CREATE UNIQUE INDEX "customers_user_id_domain_key" ON "customers"("user_id", "domain");

-- Label: name was unique globally, now unique per user
ALTER TABLE "labels" DROP CONSTRAINT IF EXISTS "labels_name_key";
CREATE UNIQUE INDEX "labels_user_id_name_key" ON "labels"("user_id", "name");

-- Email: gmailMessageId was unique globally, now unique per user
ALTER TABLE "emails" DROP CONSTRAINT IF EXISTS "emails_gmail_message_id_key";
CREATE UNIQUE INDEX "emails_user_id_gmail_message_id_key" ON "emails"("user_id", "gmail_message_id");

-- CalendarEvent: googleEventId was unique globally, now unique per user
ALTER TABLE "calendar_events" DROP CONSTRAINT IF EXISTS "calendar_events_google_event_id_key";
CREATE UNIQUE INDEX "calendar_events_user_id_google_event_id_key" ON "calendar_events"("user_id", "google_event_id");

-- Step 5: Add foreign key constraints
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_statuses" ADD CONSTRAINT "task_statuses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_categories" ADD CONSTRAINT "company_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "labels" ADD CONSTRAINT "labels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "emails" ADD CONSTRAINT "emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 6: Add user_id indexes for query performance
CREATE INDEX "tasks_user_id_idx" ON "tasks"("user_id");
CREATE INDEX "task_statuses_user_id_idx" ON "task_statuses"("user_id");
CREATE INDEX "company_categories_user_id_idx" ON "company_categories"("user_id");
CREATE INDEX "customers_user_id_idx" ON "customers"("user_id");
CREATE INDEX "labels_user_id_idx" ON "labels"("user_id");
CREATE INDEX "emails_user_id_idx" ON "emails"("user_id");
CREATE INDEX "calendar_events_user_id_idx" ON "calendar_events"("user_id");
