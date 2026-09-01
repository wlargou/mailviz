-- When a notification was dismissed, so it can stay dismissed for a while.
--
-- `createIfNotExists` looked only for a NON-dismissed notification for the same
-- entity, so dismissing one guaranteed the scheduler would recreate it on its
-- next five-minute tick. The recreation itself is deliberate — an overdue task
-- is still overdue tomorrow and the reminder should come back — but coming back
-- five minutes later makes it noise rather than a reminder.
--
-- Nullable, and null means "dismissed before this column existed", which is
-- treated as outside any cooldown. Existing dismissed rows therefore behave
-- exactly as they do today rather than being suppressed by a timestamp they
-- never had.
ALTER TABLE "notifications" ADD COLUMN "dismissed_at" TIMESTAMP(3);

-- The cooldown lookup is "this user, this type, this entity, dismissed since X".
CREATE INDEX IF NOT EXISTS "notifications_user_id_entity_id_type_dismissed_at_idx"
  ON "notifications" ("user_id", "entity_id", "type", "dismissed_at");
