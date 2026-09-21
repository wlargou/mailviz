-- The RFP register: tenders we may bid on.
CREATE TABLE "rfps" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "reference" VARCHAR(255) NOT NULL,
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "submission_format" VARCHAR(20) NOT NULL DEFAULT 'PORTAL',
    "portal_url" VARCHAR(500),
    "is_goe" BOOLEAN NOT NULL DEFAULT false,
    "budget" DECIMAL(14,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rfp_documents" (
    "id" TEXT NOT NULL,
    "rfp_id" TEXT NOT NULL,
    "kind" VARCHAR(20) NOT NULL DEFAULT 'RFP',
    "filename" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(255) NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfp_documents_pkey" PRIMARY KEY ("id")
);

-- Composite on user_id, never global: two accounts may track the same tender.
CREATE UNIQUE INDEX "rfps_user_id_reference_key" ON "rfps"("user_id", "reference");
CREATE INDEX "rfps_user_id_deadline_at_idx" ON "rfps"("user_id", "deadline_at");
CREATE INDEX "rfps_user_id_status_idx" ON "rfps"("user_id", "status");
CREATE INDEX "rfp_documents_rfp_id_idx" ON "rfp_documents"("rfp_id");

ALTER TABLE "rfps" ADD CONSTRAINT "rfps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfp_documents" ADD CONSTRAINT "rfp_documents_rfp_id_fkey" FOREIGN KEY ("rfp_id") REFERENCES "rfps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
