-- Client references: the customers' attestations that PowerM did a project
-- for them, one row per document, with its signatories.
--
-- Not "references": REFERENCES is an SQL keyword. `amount_ht`,
-- `effective_date`, `technology_tags` and `prestation_tags` are derived by
-- the service on every write (services/clientReferenceService.ts); nothing
-- else writes them.

-- CreateTable
CREATE TABLE "client_references" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_type" VARCHAR(30) NOT NULL DEFAULT 'ATTESTATION_REFERENCE',
    "work_status" VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    "customer_name" VARCHAR(500) NOT NULL,
    "customer_id" TEXT,
    "city" VARCHAR(100),
    "project_name" TEXT,
    "project_reference" VARCHAR(500),
    "attestation_number" VARCHAR(255),
    "amount" DECIMAL(16,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MAD',
    "amount_type" VARCHAR(3),
    "amount_scope" VARCHAR(255),
    "amount_ht" DECIMAL(16,2),
    "appreciation" VARCHAR(20) NOT NULL DEFAULT 'NONE',
    "appreciation_quote" TEXT,
    "project_start" DATE,
    "project_start_precision" VARCHAR(5),
    "project_end" DATE,
    "project_end_precision" VARCHAR(5),
    "signed_at" DATE,
    "signed_place" VARCHAR(100),
    "effective_date" DATE,
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "technology_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prestations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prestation_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "partners" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consortium_partners" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "details" TEXT,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "review_notes" TEXT,
    "document_storage_key" VARCHAR(500),
    "document_filename" VARCHAR(500),
    "document_mime_type" VARCHAR(255),
    "document_size" INTEGER,
    "document_uploaded_at" TIMESTAMP(3),
    "import_key" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_reference_signatories" (
    "id" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "name" VARCHAR(255),
    "role" VARCHAR(500),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "client_reference_signatories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_references_user_id_effective_date_idx" ON "client_references"("user_id", "effective_date");

-- CreateIndex
CREATE INDEX "client_references_user_id_amount_ht_idx" ON "client_references"("user_id", "amount_ht");

-- CreateIndex
CREATE INDEX "client_references_customer_id_idx" ON "client_references"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_references_user_id_import_key_key" ON "client_references"("user_id", "import_key");

-- CreateIndex
CREATE INDEX "client_reference_signatories_reference_id_idx" ON "client_reference_signatories"("reference_id");

-- AddForeignKey
ALTER TABLE "client_references" ADD CONSTRAINT "client_references_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_references" ADD CONSTRAINT "client_references_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_reference_signatories" ADD CONSTRAINT "client_reference_signatories_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "client_references"("id") ON DELETE CASCADE ON UPDATE CASCADE;

