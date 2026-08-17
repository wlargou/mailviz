-- Tracks whether a user has been through first-run setup.
--
-- Nullable with no default, so it applies to an empty database and to one with
-- existing rows alike. Existing accounts land on NULL, which means "has not seen
-- onboarding" — correct for them: the flow seeds task statuses and offers to
-- create a first deal partner, and an established account may well be missing
-- both. The wizard reports what is already configured rather than redoing it.
ALTER TABLE "users" ADD COLUMN "onboarding_completed_at" TIMESTAMP(3);
