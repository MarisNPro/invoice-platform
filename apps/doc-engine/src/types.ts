export interface RenderParty {
  name: string;
  registrationNumber?: string;
  vatNumber?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country: string;
  email?: string;
  iban?: string;
  bic?: string;
}

export interface RenderLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discount?: number;
  taxRate: number;
  /** EN 16931 tax category code */
  taxCategoryCode: string;
  lineTotal: number;
  taxAmount: number;
}

export interface RenderInput {
  invoiceNumber: string;
  invoiceType: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  issuedAt: Date;
  dueAt: Date;
  currencyCode: string;
  seller: RenderParty;
  buyer: RenderParty;
  buyerReference?: string;
  orderReference?: string;
  note?: string;
  lines: RenderLine[];
  subtotal: number;
  taxAmount: number;
  total: number;
}
