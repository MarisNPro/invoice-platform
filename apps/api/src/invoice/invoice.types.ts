export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'VOID';
export type InvoiceType = 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';

export interface CreateInvoiceDto {
  tenantId: string;
  /** Optional prefix override, e.g. "INV" or "CN". Defaults to type prefix. */
  prefix?: string;
  type: InvoiceType;
  sellerId: string;
  buyerId: string;
  issuedAt: Date;
  dueAt: Date;
  currencyCode?: string;
  buyerReference?: string;
  orderReference?: string;
  note?: string;
  lines: CreateInvoiceLineDto[];
}

export interface CreateInvoiceLineDto {
  lineNumber: number;
  productId?: string;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  /** Discount as a fraction, e.g. 0.10 = 10% */
  discount?: number;
  taxRateId?: string;
}

/** Row returned by the next_invoice_number() Postgres function */
interface InvoiceNumberRow {
  invoice_number: string;
}

export type { InvoiceNumberRow };
