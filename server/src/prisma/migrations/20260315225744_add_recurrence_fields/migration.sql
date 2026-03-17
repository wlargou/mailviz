-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "recurrence" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "recurring_event_id" TEXT;
