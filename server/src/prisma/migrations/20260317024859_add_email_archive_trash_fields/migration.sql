-- AlterTable
ALTER TABLE "emails" ADD COLUMN     "is_archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_trashed" BOOLEAN NOT NULL DEFAULT false;
