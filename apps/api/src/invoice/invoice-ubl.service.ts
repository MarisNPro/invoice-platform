/**
 * InvoiceUblService
 *
 * Generates a Peppol BIS Billing 3.0 / UBL 2.1 XML invoice document.
 *
 * Covers all mandatory EN 16931 fields:
 *  BT-23  Business process type (ProfileID)
 *  BT-24  Specification identifier (CustomizationID)
 *  BT-1   Invoice number
 *  BT-2   Issue date
 *  BT-3   Invoice type code (380 / 381 / 383)
 *  BT-5   Currency
 *  BT-9   Payment due date
 *  BG-4   Seller party: BT-27 name, BT-30 reg, BT-31 VAT, BT-35 address
 *  BG-7   Buyer party:  BT-44 name, BT-48 VAT, BT-50 address
 *  BG-22  Document totals: BT-106/107/108/109/112/113/115 + BT-110 in TaxTotal
 *  BG-23  VAT breakdown:   BT-116 taxable, BT-117 VAT, BT-118 cat, BT-119 rate
 *  BG-25  Invoice lines:   BG-29 price (BT-146), BG-30 VAT, BG-31 item (BT-153)
 *  BT-84  Seller IBAN (PaymentMeans)
 *  BT-85  Seller BIC
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UblInvoiceBuilder } from '@invoice/ubl-builder';
import type { UblInvoiceInput, UblLine } from '@invoice/ubl-builder';
import type { TaxCategoryCode } from '@invoice/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma, BankAccount } from '@prisma/client';

// ── Prisma return type ────────────────────────────────────────────────────────

type InvoiceWithAll = Prisma.InvoiceGetPayload<{
  include: {
    buyer:         { include: { addresses: true } };
    seller:        { include: { addresses: true } };
    lines:         { include: { taxRate: true } };
    vatBreakdowns: true;
  };
}>;

// ── UBL invoice type code map ─────────────────────────────────────────────────

const TYPE_CODE: Record<string, '380' | '381' | '383'> = {
  INVOICE:     '380',
  CREDIT_NOTE: '381',
  DEBIT_NOTE:  '383',
};

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class InvoiceUblService {
  private readonly logger  = new Logger(InvoiceUblService.name);
  private readonly builder = new UblInvoiceBuilder();

  constructor(private readonly prisma: PrismaService) {}

  // ── Public entry-point ────────────────────────────────────────────────────

  async generate(
    tenantId:   string,
    idOrNumber: string,
  ): Promise<{ xml: string; filename: string }> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber);

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        tenantId,
        ...(isUuid ? { id: idOrNumber } : { number: idOrNumber }),
      },
      include: {
        buyer:         { include: { addresses: { orderBy: { isDefault: 'desc' } } } },
        seller:        { include: { addresses: { orderBy: { isDefault: 'desc' } } } },
        lines:         { include: { taxRate: true }, orderBy: { lineNumber: 'asc' } },
        vatBreakdowns: { orderBy: { vatRatePercent: 'asc' } },
      },
    });

    if (!invoice) throw new NotFoundException(`Invoice ${idOrNumber} not found`);

    const bank = await this.prisma.bankAccount.findFirst({
      where: { tenantId, isDefault: true },
    });

    this.logger.log(`Generating UBL XML for ${invoice.number}`);
    const xml = this.buildUbl(invoice, bank);
    return { xml, filename: `${invoice.number}.xml` };
  }

  // ── UBL builder ───────────────────────────────────────────────────────────

  private buildUbl(inv: InvoiceWithAll, bank: BankAccount | null): string {
    const sellerAddr = inv.seller.addresses[0];
    const buyerAddr  = inv.buyer.addresses[0];

    // ── BG-25 Invoice lines ──────────────────────────────────────────────────
    const lines: UblLine[] = inv.lines.map((ln) => {
      // TaxRate.rate is a fractional decimal: 0.21 = 21 %
      const rateDecimal = Number(ln.taxRate?.rate ?? 0);
      // Round to 2 dp to avoid floating-point noise: 0.21 → 21.00
      const taxPercent  = Math.round(rateDecimal * 10000) / 100;
      // EN 16931 BT-118: prefer stored category code, fall back to S/Z inference
      const catCode = (
        ln.taxRate?.categoryCode ?? (rateDecimal === 0 ? 'Z' : 'S')
      ) as TaxCategoryCode;

      return {
        id:                  ln.lineNumber,
        description:         ln.description,
        quantity:            Number(ln.quantity),
        unitCode:            ln.unit,
        unitPrice:           Number(ln.unitPrice),
        lineExtensionAmount: Number(ln.lineTotal),   // BT-131
        taxCategoryCode:     catCode,                // BT-151
        taxPercent,                                  // BT-152
        taxAmount:           Number(ln.taxAmount),
      };
    });

    // ── UblInvoiceInput ──────────────────────────────────────────────────────
    const input: UblInvoiceInput = {
      invoiceNumber:  inv.number,
      typeCode:       TYPE_CODE[inv.type] ?? '380',
      issueDate:      toIsoDate(inv.issuedAt),
      dueDate:        inv.dueAt ? toIsoDate(inv.dueAt) : undefined,
      currencyCode:   inv.currencyCode,
      note:           inv.note           ?? undefined,
      buyerReference: inv.buyerReference ?? undefined,
      orderReference: inv.orderReference ?? undefined,

      // BG-4 Seller
      seller: {
        name:               inv.seller.name,
        registrationNumber: inv.seller.businessId ?? undefined,   // BT-30
        vatNumber:          inv.seller.vatNumber  ?? undefined,   // BT-31
        street:             sellerAddr?.street,
        city:               sellerAddr?.city,
        postalCode:         sellerAddr?.postalCode,
        country:            inv.seller.country,
        iban:               bank?.iban             ?? undefined,  // BT-84
        bic:                bank?.bic              ?? undefined,  // BT-85
      },

      // BG-7 Buyer
      buyer: {
        name:               inv.buyer.name,
        registrationNumber: inv.buyer.businessId ?? undefined,   // BT-47
        vatNumber:          inv.buyer.vatNumber  ?? undefined,   // BT-48
        street:             buyerAddr?.street,
        city:               buyerAddr?.city,
        postalCode:         buyerAddr?.postalCode,
        country:            inv.buyer.country,
        email:              inv.buyer.email       ?? undefined,
      },

      lines,

      // BG-22 Document totals
      taxAmount:     Number(inv.taxAmount),   // BT-110
      taxableAmount: Number(inv.subtotal),    // BT-106 / BT-109
      payableAmount: Number(inv.total),       // BT-112 / basis for BT-115
      // BT-107, BT-108, BT-113 default to 0 — no doc-level allowances/charges
    };

    return this.builder.build(input);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a Date (stored as @db.Date, time part is midnight UTC) to YYYY-MM-DD */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
