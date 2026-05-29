-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'PARTIALLY_PAID';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "creditNoteId" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "tenantId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(15,2),
ALTER COLUMN "method" DROP NOT NULL;

-- Remove the default now that existing rows have a value
ALTER TABLE "payments" ALTER COLUMN "tenantId" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "invoices_creditNoteId_key" ON "invoices"("creditNoteId");

-- CreateIndex
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
