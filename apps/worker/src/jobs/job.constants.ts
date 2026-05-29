export const QUEUE_COMPANY_SYNC       = 'company-sync';
export const QUEUE_INVOICE_EMAIL      = 'invoice-email';
export const QUEUE_MONTHLY_RESET      = 'monthly-reset';
export const QUEUE_DUNNING_SCHEDULER  = 'dunning-scheduler';
export const QUEUE_CLOUD_ARCHIVE_SYNC = 'cloud-archive-sync';

export const JobName = {
  SYNC_LV:           'sync-companies-lv',
  SYNC_LT:           'sync-companies-lt',
  SEND_INVOICE:      'send-invoice-email',
  RESET_MONTHLY:     'reset-monthly-counters',
  DUNNING_SCHEDULER: 'dunning-scheduler',
  ARCHIVE_SYNC:      'archive-invoice',
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
