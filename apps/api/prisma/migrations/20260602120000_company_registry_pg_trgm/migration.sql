-- Enable trigram fuzzy/substring search (used by the LV/LT company registry search,
-- replacing Elasticsearch).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "company_registry" (
    "id" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "regNumber" TEXT NOT NULL,
    "vatNumber" TEXT,
    "legalForm" TEXT,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_registry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_registry_country_idx" ON "company_registry"("country");

-- Trigram GIN index on name for fuzzy/substring search (hybrid ILIKE + similarity()).
-- Managed via raw SQL — not expressible in vanilla Prisma schema.
CREATE INDEX "company_registry_name_trgm_idx" ON "company_registry" USING gin ("name" gin_trgm_ops);
