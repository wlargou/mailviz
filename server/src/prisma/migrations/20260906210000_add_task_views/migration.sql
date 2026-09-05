-- Saved task views: a name over the filters and sort the list had on.
CREATE TABLE "task_views" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "filters" JSONB NOT NULL,
    "sort_by" VARCHAR(40) NOT NULL DEFAULT 'createdAt',
    "sort_order" VARCHAR(4) NOT NULL DEFAULT 'desc',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_views_user_id_name_key" ON "task_views"("user_id", "name");
CREATE INDEX "task_views_user_id_idx" ON "task_views"("user_id");

ALTER TABLE "task_views" ADD CONSTRAINT "task_views_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
