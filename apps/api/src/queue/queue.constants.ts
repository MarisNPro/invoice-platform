export const QUEUE_INVOICE_EMAIL     = 'invoice-email';
export const QUEUE_CLOUD_ARCHIVE_SYNC = 'cloud-archive-sync';

export interface CloudArchiveSyncJobData {
  invoiceId: string;
  tenantId:  string;
}

export interface SendInvoiceEmailJobData {
  invoiceId:      string;
  recipientEmail: string;
  language:       string;
  tenantId:       string;
  transmissionId: string;
}
