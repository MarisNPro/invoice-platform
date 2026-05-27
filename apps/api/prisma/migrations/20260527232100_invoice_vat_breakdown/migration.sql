-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "language" VARCHAR(5) DEFAULT 'en',
ADD COLUMN     "paymentTermsNote" TEXT;

-- CreateTable
CREATE TABLE "invoice_vat_breakdowns" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "vatCategoryCode" VARCHAR(2) NOT NULL,
    "vatRatePercent" DECIMAL(5,2) NOT NULL,
    "taxableAmount" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "invoice_vat_breakdowns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_vat_breakdowns_invoiceId_idx" ON "invoice_vat_breakdowns"("invoiceId");

-- AddForeignKey
ALTER TABLE "invoice_vat_breakdowns" ADD CONSTRAINT "invoice_vat_breakdowns_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
