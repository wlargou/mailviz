-- A piece's files become its versions, with who uploaded each.
ALTER TABLE "rfp_documents" ADD COLUMN "version" INTEGER;
ALTER TABLE "rfp_documents" ADD COLUMN "uploaded_by_id" TEXT;

-- Existing piece files are numbered in the order they were uploaded. The
-- uploader of those is not known, so it stays NULL rather than being guessed.
UPDATE "rfp_documents" d
SET "version" = n.v
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "created_at", "id") AS v
  FROM "rfp_documents"
  WHERE "item_id" IS NOT NULL
) n
WHERE d."id" = n."id";

CREATE UNIQUE INDEX "rfp_documents_item_id_version_key" ON "rfp_documents"("item_id", "version");

ALTER TABLE "rfp_documents" ADD CONSTRAINT "rfp_documents_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "rfp_verifiers" (
    "id" TEXT NOT NULL,
    "rfp_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfp_verifiers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rfp_verifiers_rfp_id_user_id_key" ON "rfp_verifiers"("rfp_id", "user_id");
CREATE INDEX "rfp_verifiers_user_id_idx" ON "rfp_verifiers"("user_id");

ALTER TABLE "rfp_verifiers" ADD CONSTRAINT "rfp_verifiers_rfp_id_fkey"
  FOREIGN KEY ("rfp_id") REFERENCES "rfps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfp_verifiers" ADD CONSTRAINT "rfp_verifiers_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "rfp_item_verifications" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "decision" VARCHAR(20) NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfp_item_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rfp_item_verifications_item_id_user_id_key" ON "rfp_item_verifications"("item_id", "user_id");
CREATE INDEX "rfp_item_verifications_document_id_idx" ON "rfp_item_verifications"("document_id");
CREATE INDEX "rfp_item_verifications_user_id_idx" ON "rfp_item_verifications"("user_id");

ALTER TABLE "rfp_item_verifications" ADD CONSTRAINT "rfp_item_verifications_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "rfp_folder_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfp_item_verifications" ADD CONSTRAINT "rfp_item_verifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfp_item_verifications" ADD CONSTRAINT "rfp_item_verifications_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "rfp_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
