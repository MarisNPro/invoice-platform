/**
 * EN 16931-1:2017 semantic validation.
 *
 * Implements a subset of the business rules defined in EN 16931-1:2017
 * and CEN/TS 16931-3-2:2020 (UBL binding).
 *
 * Rules are identified by their standard identifiers (BR-*, BR-CO-*).
 * Extend this class to add more rules as needed.
 */

export interface ValidationIssue {
  /** Rule identifier e.g. BR-01 */
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface InvoiceForValidation {
  invoiceNumber: string;
  invoiceType: string;
  issueDate: Date;
  dueDate: Date;
  currencyCode: string;
  seller: {
    name: string;
    vatNumber?: string;
    country: string;
    street?: string;
    city?: string;
    postalCode?: string;
  };
  buyer: {
    name: string;
    country: string;
  };
  buyerReference?: string;
  lines: Array<{
    id: number;
    description: string;
    quantity: number;
    unitPrice: number;
    taxCategoryCode: string;
    taxPercent: number;
    lineTotal: number;
    taxAmount: number;
  }>;
  subtotal: number;
  taxAmount: number;
  total: number;
}

export class En16931Validator {
  validate(invoice: InvoiceForValidation): ValidationResult {
    const issues: ValidationIssue[] = [];

    this.checkBR01(invoice, issues);
    this.checkBR02(invoice, issues);
    this.checkBR04(invoice, issues);
    this.checkBR05(invoice, issues);
    this.checkBR06(invoice, issues);
    this.checkBR07(invoice, issues);
    this.checkBR08(invoice, issues);
    this.checkBRCO05(invoice, issues);
    this.checkBRCO15(invoice, issues);
    this.checkBR16(invoice, issues);

    return { valid: issues.every((i) => i.severity !== 'error'), issues };
  }

  /** BR-01: An Invoice shall have a Specification identifier. (checked at UBL level) */
  private checkBR01(inv: InvoiceForValidation, issues: ValidationIssue[]) {
    if (!inv.invoiceNumber?.trim()) {
      issues.push({ rule: 'BR-02', severity: 'error', message: 'Invoice number (BT-1) is mandatory.', path: 'invoiceNumber' });
    }
  }

  /** BR-02: An Invoice shall have an Invoice issue date. */
  private checkBR02(inv: InvoiceForValidation, issues: ValidationIssue[]) {
    if (!inv.issueDate) {
      issues.push({ rule: 'BR-02', severity: 'error', message: 'Invoice issue date (BT-2) is mandatory.', path: 'issueDate' });
    }
  }

  /** BR-04: An Invoice shall have an Invoice type code. */
  private checkBR04(inv: InvoiceForValidation, issues: ValidationIssue[]) {
    if (!['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(inv.invoiceType)) {
      issues.push({ rule: 'BR-04', severity: 'error', message: 'Invoice type code (BT-3) must be valid.' });
    }
  }

  /** BR-05: An Invoice shall have an Invoice currency code. */
  private checkBR05(inv: InvoiceForValidation, issues: ValidationIssue[]) {
    if (!inv.currencyCode || inv.currencyCode.length !== 3) {
      issues.push({ rule: 'BR-05', severity: 'error', message: 'Currency code (BT-5) is mandatory and must be 3 characters.', path: 'currencyCode' });
    }
  }

  /** BR-06: An Invoice shall contain the Seller name. */
  private checkBR06(inv: InvoiceForValidation, issues: ValidationIssue[]) {
    if (!inv.seller.name?.trim()) {
      issues.push({ rule: 'BR-06', severity: 'error', message: 'Seller name (BT-27) is mandatory.', path: 'seller.name' });
    }
  }

  /** BR-07: An Invoice shall contain the Buyer name. */
  private checkBR07(inv: InvoiceForValidation, issues: ValidationIssue[]) {
    if (!inv.buyer.name?.trim()) {
      issues.push({ rule: 'BR-07', severity: 'error', message: 'Buyer name (BT-44) is mandatory.', path: 'buyer.name' });
    }
  }

  /** BR-08: An Invoice shall contain the Seller postal address. */
  private checkBR08(inv: InvoiceForValidation, issues: ValidationIssue[]) {
    if (!inv.seller.country) {
      issues.push({ rule: 'BR-08', severity: 'error', message: 'Seller country code (BT-40) is mandatory.', path: 'seller.country' });
    }
  }

  /** BR-CO-05: VAT accounting currency must equal document currency (simplified). */
  private checkBRCO05(inv: InvoiceForValidation, issues: ValidationIssue[]) {
    if (inv.currencyCode && inv.currencyCode.length !== 3) {
      issues.push({ rule: 'BR-CO-05', severity: 'error', message: 'Document currency (BT-5) must be ISO 4217.' });
    }
  }

  /** BR-CO-15: Invoice total with VAT = Invoice total without VAT + VAT total. */
  private checkBRCO15(inv: InvoiceForValidation, issues: ValidationIssue[]) {
    const expected = round2(inv.subtotal + inv.taxAmount);
    if (Math.abs(expected - inv.total) > 0.01) {
      issues.push({
        rule: 'BR-CO-15',
        severity: 'error',
        message: `Total (${inv.total}) ≠ subtotal (${inv.subtotal}) + tax (${inv.taxAmount}) = ${expected}.`,
      });
    }
  }

  /** BR-16: An Invoice shall have at least one Invoice line. */
  private checkBR16(inv: InvoiceForValidation, issues: ValidationIssue[]) {
    if (!inv.lines || inv.lines.length === 0) {
      issues.push({ rule: 'BR-16', severity: 'error', message: 'An invoice must have at least one line (BG-25).' });
    }
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
