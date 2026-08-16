-- CreateTable
CREATE TABLE "email_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "gmail_draft_id" TEXT NOT NULL,
    "gmail_message_id" TEXT,
    "thread_id" TEXT,
    "to" TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" VARCHAR(500) NOT NULL DEFAULT '',
    "html_body" TEXT NOT NULL DEFAULT '',
    "snippet" TEXT,
    "has_attachment" BOOLEAN NOT NULL DEFAULT false,
    "attachments" JSONB DEFAULT '[]',
    "last_edited_at" TIMESTAMP(3) NOT NULL,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_drafts_user_id_idx" ON "email_drafts"("user_id");
CREATE INDEX "email_drafts_user_id_last_edited_at_idx" ON "email_drafts"("user_id", "last_edited_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_drafts_user_id_gmail_draft_id_key" ON "email_drafts"("user_id", "gmail_draft_id");

-- AddForeignKey
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
