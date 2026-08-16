-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(20) NOT NULL DEFAULT 'template',
    "subject" VARCHAR(500),
    "body" TEXT NOT NULL,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_templates_user_id_idx" ON "email_templates"("user_id");
CREATE INDEX "email_templates_user_id_kind_idx" ON "email_templates"("user_id", "kind");

-- CreateIndex
-- Composite on user_id: names are unique per user, never globally. A global
-- unique here would let one tenant's "Follow-up" block every other tenant's.
CREATE UNIQUE INDEX "email_templates_user_id_name_key" ON "email_templates"("user_id", "name");

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
