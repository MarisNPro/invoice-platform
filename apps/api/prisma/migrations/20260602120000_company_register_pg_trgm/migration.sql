-- Enable trigram fuzzy/substring search for the national company register
-- (LV/LT), replacing Elasticsearch. Supabase's role can create this extension.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable: tenant-AGNOSTIC public register data (no tenantId).
CREATE TABLE "company_register" (
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

    CONSTRAINT "company_register_pkey" PRIMARY KEY ("id")
);

-- Natural key: idempotent sync upserts ON CONFLICT (country, "regNumber").
CREATE UNIQUE INDEX "company_register_country_regNumber_key" ON "company_register"("country", "regNumber");

CREATE INDEX "company_register_country_idx" ON "company_register"("country");

-- Trigram GIN index on name for fuzzy/substring search (`name % $1`, ranked by
-- similarity()). Managed via raw SQL — not expressible in vanilla Prisma schema.
CREATE INDEX "company_register_name_trgm_idx" ON "company_register" USING gin ("name" gin_trgm_ops);
