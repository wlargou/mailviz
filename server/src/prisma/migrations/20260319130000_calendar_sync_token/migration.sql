-- Add calendar sync token for incremental sync
ALTER TABLE "google_auth" ADD COLUMN "calendar_sync_token" TEXT;
