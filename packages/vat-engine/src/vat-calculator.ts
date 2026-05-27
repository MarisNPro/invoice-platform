import type { TaxCategoryCode } from '@invoice/shared-types';

export interface VatLineInput {
  quantity: number;
  unitPrice: number;
  /** Discount as a fraction: 0.10 = 10% off */
  discountRate?: number;
  /** Fractional VAT rate e.g. 0.22 for 22% */
  vatRate: number;
  taxCategoryCode: TaxCategoryCode;
}

export interface LineWithTax extends VatLineInput {
  netAmount: number;    // quantity * unitPrice * (1 - discount)
  vatAmount: number;    // netAmount * vatRate  (0 for exempt/zero)
  grossAmount: number;  // netAmount + vatAmount
}

export interface VatResult {
  lines: LineWithTax[];
  subtotal: number;    // sum of netAmount
  vatAmount: number;   // sum of vatAmount
  total: number;       // subtotal + vatAmount
  /** Per-category breakdown for UBL TaxSubtotal */
  taxBreakdown: Array<{
    categoryCode: TaxCategoryCode;
    vatRate: number;
    taxableAmount: number;
    taxAmount: number;
  }>;
}

const ZERO_RATE_CATEGORIES: TaxCategoryCode[] = ['Z', 'E', 'AE', 'K', 'G', 'O'];

export class VatCalculator {
  /**
   * Calculates VAT for a list of invoice lines using the amount-based method
   * (sum of line amounts, then apply rate) as required by EN 16931.
   */
  calculate(lines: VatLineInput[]): VatResult {
    const computed = lines.map((l): LineWithTax => {
      const net = round2(l.quantity * l.unitPrice * (1 - (l.discountRate ?? 0)));
      const isZeroRated = ZERO_RATE_CATEGORIES.includes(l.taxCategoryCode);
      const vat = isZeroRated ? 0 : round2(net * l.vatRate);
      return {
        ...l,
        netAmount: net,
        vatAmount: vat,
        grossAmount: round2(net + vat),
      };
    });

    const subtotal = round2(computed.reduce((s, l) => s + l.netAmount, 0));
    const vatAmount = round2(computed.reduce((s, l) => s + l.vatAmount, 0));

    // Group by tax category + rate for UBL subtotals
    const groups = new Map<string, { taxableAmount: number; taxAmount: number; categoryCode: TaxCategoryCode; vatRate: number }>();
    for (const l of computed) {
      const key = `${l.taxCategoryCode}_${l.vatRate}`;
      const g = groups.get(key) ?? { taxableAmount: 0, taxAmount: 0, categoryCode: l.taxCategoryCode, vatRate: l.vatRate };
      g.taxableAmount = round2(g.taxableAmount + l.netAmount);
      g.taxAmount     = round2(g.taxAmount     + l.vatAmount);
      groups.set(key, g);
    }

    return {
      lines: computed,
      subtotal,
      vatAmount,
      total: round2(subtotal + vatAmount),
      taxBreakdown: [...groups.values()],
    };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
