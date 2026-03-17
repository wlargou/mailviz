-- AlterTable
ALTER TABLE "emails" ADD COLUMN     "cc" TEXT[],
ADD COLUMN     "from_name" VARCHAR(255),
ADD COLUMN     "has_attachment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_starred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "size_estimate" INTEGER;

-- AlterTable
ALTER TABLE "google_auth" ADD COLUMN     "last_history_id" VARCHAR(50),
ADD COLUMN     "last_mail_sync_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "email_attachments" (
    "id" TEXT NOT NULL,
    "email_id" TEXT NOT NULL,
    "gmail_attachment_id" TEXT NOT NULL,
    "filename" VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(255) NOT NULL,
    "size" INTEGER NOT NULL,

    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_attachments_email_id_idx" ON "email_attachments"("email_id");

-- CreateIndex
CREATE INDEX "emails_is_read_idx" ON "emails"("is_read");

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;
