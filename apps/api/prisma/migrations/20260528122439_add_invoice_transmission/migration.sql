-- CreateEnum
CREATE TYPE "TransmissionChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'PEPPOL');

-- CreateEnum
CREATE TYPE "TransmissionStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'BOUNCED');

-- CreateTable
CREATE TABLE "invoice_transmissions" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "channel" "TransmissionChannel" NOT NULL,
    "status" "TransmissionStatus" NOT NULL DEFAULT 'PENDING',
    "recipientEndpoint" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "jobId" TEXT,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_transmissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_transmissions_invoiceId_idx" ON "invoice_transmissions"("invoiceId");

-- AddForeignKey
ALTER TABLE "invoice_transmissions" ADD CONSTRAINT "invoice_transmissions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
