-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "reminders" JSONB,
ADD COLUMN     "visibility" VARCHAR(20);
