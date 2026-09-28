-- Mail from machines (noreply@, notifications@ …) leaves Primary for Updates.
-- Defaults to false: existing rows are classified by the backfill script,
-- because the rule is the TypeScript contact-kind vocabulary and is tuned.
ALTER TABLE "emails" ADD COLUMN "is_automated" BOOLEAN NOT NULL DEFAULT false;
