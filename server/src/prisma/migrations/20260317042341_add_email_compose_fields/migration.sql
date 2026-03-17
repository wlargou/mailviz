-- AlterTable
ALTER TABLE "emails" ADD COLUMN     "bcc" TEXT[],
ADD COLUMN     "in_reply_to" VARCHAR(500),
ADD COLUMN     "message_id" VARCHAR(500),
ADD COLUMN     "references" TEXT;
