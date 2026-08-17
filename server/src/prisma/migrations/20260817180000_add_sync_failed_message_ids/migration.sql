-- Gmail message ids whose fetch failed, so a later sync can retry them.
--
-- A failed fetch was previously skipped and forgotten while the history cursor
-- moved past it, which made a transient error cost a message permanently.
--
-- Defaulted to an empty array rather than nullable: every read treats it as a
-- list, and a NULL would make each call site guard for it.
ALTER TABLE "google_auth"
  ADD COLUMN "sync_failed_message_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
