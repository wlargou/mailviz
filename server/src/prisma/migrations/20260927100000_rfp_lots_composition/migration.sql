-- Lots, and the composition of the response (dossiers and their pieces).

CREATE TABLE "rfp_lots" (
    "id" TEXT NOT NULL,
    "rfp_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "budget" DECIMAL(14,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rfp_lots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "rfp_lots_rfp_id_number_key" ON "rfp_lots"("rfp_id", "number");
ALTER TABLE "rfp_lots" ADD CONSTRAINT "rfp_lots_rfp_id_fkey" FOREIGN KEY ("rfp_id") REFERENCES "rfps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every tender has at least one lot. Existing tenders become a single
-- "Lot unique" carrying the budget they already had, so rfps.budget — now
-- the derived total — is already correct for them. On an empty database
-- this inserts nothing, which is what CI applies it to.
INSERT INTO "rfp_lots" ("id", "rfp_id", "number", "title", "budget", "created_at", "updated_at")
SELECT gen_random_uuid()::text, "id", 1, 'Lot unique', "budget", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "rfps";

CREATE TABLE "rfp_folders" (
    "id" TEXT NOT NULL,
    "rfp_id" TEXT NOT NULL,
    "lot_id" TEXT,
    "kind" VARCHAR(30) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rfp_folders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rfp_folders_rfp_id_idx" ON "rfp_folders"("rfp_id");
CREATE INDEX "rfp_folders_lot_id_idx" ON "rfp_folders"("lot_id");
ALTER TABLE "rfp_folders" ADD CONSTRAINT "rfp_folders_rfp_id_fkey" FOREIGN KEY ("rfp_id") REFERENCES "rfps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfp_folders" ADD CONSTRAINT "rfp_folders_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "rfp_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "rfp_folder_items" (
    "id" TEXT NOT NULL,
    "folder_id" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'TODO',
    "notes" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rfp_folder_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rfp_folder_items_folder_id_idx" ON "rfp_folder_items"("folder_id");
ALTER TABLE "rfp_folder_items" ADD CONSTRAINT "rfp_folder_items_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "rfp_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A prepared piece's files live beside the tender's own documents.
ALTER TABLE "rfp_documents" ADD COLUMN "item_id" TEXT;
CREATE INDEX "rfp_documents_item_id_idx" ON "rfp_documents"("item_id");
ALTER TABLE "rfp_documents" ADD CONSTRAINT "rfp_documents_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "rfp_folder_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
