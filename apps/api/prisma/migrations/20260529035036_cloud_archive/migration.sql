-- CreateEnum
CREATE TYPE "CloudProvider" AS ENUM ('GOOGLE_DRIVE', 'DROPBOX', 'ONEDRIVE');

-- CreateTable
CREATE TABLE "cloud_archives" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provider" "CloudProvider" NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "folderPath" TEXT NOT NULL DEFAULT '/InvoiceArchive',
    "folderId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cloud_archives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cloud_archives_tenantId_isActive_idx" ON "cloud_archives"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "cloud_archives_tenantId_provider_key" ON "cloud_archives"("tenantId", "provider");

-- AddForeignKey
ALTER TABLE "cloud_archives" ADD CONSTRAINT "cloud_archives_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
