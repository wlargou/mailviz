-- Why Google stopped accepting this account's grant, and since when.
-- Written by the syncs and the token refresh when Google refuses the grant
-- itself (invalid_grant and the like, never a 5xx or a network error), and
-- cleared by the next successful refresh or reconnect — so a dead grant shows
-- in Settings instead of only as mail that stops arriving. Both nullable:
-- every existing row starts healthy.
ALTER TABLE "google_auth" ADD COLUMN "auth_error" VARCHAR(50),
ADD COLUMN "auth_error_at" TIMESTAMP(3);
