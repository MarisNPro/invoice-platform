-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "monthlyAiCallCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "monthlyAiCallLimit" INTEGER NOT NULL DEFAULT -1,
ADD COLUMN     "monthlyInvoiceCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "monthlyInvoiceLimit" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "planExpiresAt" TIMESTAMP(3),
ADD COLUMN     "planStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lastName" TEXT;

-- CreateIndex
CREATE INDEX "users_isActive_idx" ON "users"("isActive");
