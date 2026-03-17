-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "attendees" JSONB,
ADD COLUMN     "conference_link" TEXT;
