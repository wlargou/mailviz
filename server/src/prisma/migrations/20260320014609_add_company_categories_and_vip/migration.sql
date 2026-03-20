-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "is_vip" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "category_id" TEXT,
ADD COLUMN     "is_vip" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "company_categories" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "color" VARCHAR(7) NOT NULL DEFAULT '#4589ff',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_categories_name_key" ON "company_categories"("name");

-- CreateIndex
CREATE INDEX "customers_category_id_idx" ON "customers"("category_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "company_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
