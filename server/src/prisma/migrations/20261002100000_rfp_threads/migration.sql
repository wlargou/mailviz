-- Mail threads filed under a tender.
CREATE TABLE "rfp_threads" (
    "id" TEXT NOT NULL,
    "rfp_id" TEXT NOT NULL,
    "thread_id" VARCHAR(255) NOT NULL,
    "linked_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rfp_threads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rfp_threads_rfp_id_thread_id_key" ON "rfp_threads"("rfp_id", "thread_id");
CREATE INDEX "rfp_threads_thread_id_idx" ON "rfp_threads"("thread_id");

ALTER TABLE "rfp_threads" ADD CONSTRAINT "rfp_threads_rfp_id_fkey" FOREIGN KEY ("rfp_id") REFERENCES "rfps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfp_threads" ADD CONSTRAINT "rfp_threads_linked_by_id_fkey" FOREIGN KEY ("linked_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
