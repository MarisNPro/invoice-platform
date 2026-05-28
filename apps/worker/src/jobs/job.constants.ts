export const QUEUE_COMPANY_SYNC  = 'company-sync';
export const QUEUE_INVOICE_EMAIL = 'invoice-email';

export const JobName = {
  SYNC_LV:       'sync-companies-lv',
  SYNC_LT:       'sync-companies-lt',
  SEND_INVOICE:  'send-invoice-email',
} as const;

export type JobName = (typeof JobName)[keyof typeof JobName];

export interface CompanySyncJobData {
  country: 'LV' | 'LT';
  /** Override the default CSV URL (useful for manual runs / tests) */
  csvUrl?: string;
}

export interface SendInvoiceEmailJobData {
  invoiceId:      string;
  recipientEmail: string;
  language:       string;
  tenantId:       string;
  transmissionId: string;
}
