export const QUEUE_INVOICE_EMAIL = 'invoice-email';

export interface SendInvoiceEmailJobData {
  invoiceId:      string;
  recipientEmail: string;
  language:       string;
  tenantId:       string;
  transmissionId: string;
}
