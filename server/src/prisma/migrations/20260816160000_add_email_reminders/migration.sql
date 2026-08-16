-- Snooze and follow-up reminders.
--
-- Deliberately its own table rather than columns on `emails`: the Gmail sync
-- rewrites every `emails` row (and all of `label_ids`) roughly every 60
-- seconds, so snooze state stored there is state the sync would undo. Keyed by
-- the Gmail thread id, which outlives any individual message row.

-- CreateTable
CREATE TABLE "email_reminders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'armed',
    "remind_at" TIMESTAMP(3) NOT NULL,
    "armed_at" TIMESTAMP(3) NOT NULL,
    "was_in_inbox" BOOLEAN NOT NULL DEFAULT true,
    "resolution" VARCHAR(20),
    "fired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- "which of my threads are hidden right now" — read on every mail list query.
CREATE INDEX "email_reminders_user_id_state_kind_idx" ON "email_reminders"("user_id", "state", "kind");

-- CreateIndex
-- The scheduler's due query: armed rows ordered by remind_at.
CREATE INDEX "email_reminders_state_remind_at_idx" ON "email_reminders"("state", "remind_at");
