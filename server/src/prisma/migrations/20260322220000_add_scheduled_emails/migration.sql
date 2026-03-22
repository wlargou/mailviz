-- CreateTable
CREATE TABLE "scheduled_emails" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "send_at" TIMESTAMP(3) NOT NULL,
    "mode" VARCHAR(20) NOT NULL,
    "to" TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" VARCHAR(500) NOT NULL,
    "html_body" TEXT NOT NULL,
    "attachments" JSONB DEFAULT '[]',
    "reply_to_email_id" TEXT,
    "forward_existing_attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sent_message_id" TEXT,
    "sent_thread_id" TEXT,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_emails_user_id_idx" ON "scheduled_emails"("user_id");
CREATE INDEX "scheduled_emails_status_send_at_idx" ON "scheduled_emails"("status", "send_at");

-- AddForeignKey
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_reply_to_email_id_fkey" FOREIGN KEY ("reply_to_email_id") REFERENCES "emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;
