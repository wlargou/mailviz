-- `email_reminders` was created without a foreign key to `users`, so nothing
-- stopped a reminder from outliving its owner or naming a user that never
-- existed. Every other user-scoped table in this schema cascades; this one is
-- brought in line.
--
-- The DELETE is not defensive dressing: the constraint cannot be added while a
-- single orphan row exists, and an orphaned reminder is unreachable anyway —
-- every read of this table is filtered by `user_id`.
DELETE FROM "email_reminders" r
WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u.id = r.user_id);

ALTER TABLE "email_reminders"
  ADD CONSTRAINT "email_reminders_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
